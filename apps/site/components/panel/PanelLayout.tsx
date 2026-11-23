"use client";

import { Component, createRef, type ReactNode } from "react";
import { type Box, slideFrames } from "../../lib/flip";
import {
  boxesNear,
  boxOf,
  type ContentRule,
  cancelFlip,
  childBoxes,
  type FlipGroup,
  motionMs,
  playFlips,
  reducedMotion,
} from "../../lib/motion";
import { type Anchor, findAnchor, holdAnchor } from "../../lib/panel-anchor";
import { fitNow } from "../../lib/panel-fit";

// Микроанимация открытия и закрытия панели иконки (решение владельца 12 ноября 2026). Панель
// открывается и закрывается и через историю браузера (✕ и Esc уходят «назад»), поэтому переход
// запускается не из щелчка, а здесь — по смене open, как бы она ни случилась.
// - getSnapshotBeforeUpdate: старая раскладка ещё на экране — запоминаются места всего, что переедет,
//   а при закрытии — копия панели.
// - componentDidUpdate: новая раскладка записана — элементы переходят со старых мест на новые
//   (lib/motion.ts, Web Animations API), копия панели уходит и удаляется.
// Появление самой панели — анимация в стилях (.icon-panel, app/globals.css). «Уменьшить движение» в
// системе — без анимаций.
//
// Панель во всю высоту страницы (решение владельца 18 ноября 2026 — панель появляется плавно, без
// фризов): страница перестраивается один раз — колонка под панель сразу своей ширины, — а всё в левой
// колонке доезжает до новых мест сдвигом и сжатием. Прежде ширина колонок переходила в стилях, и
// браузер заново раскладывал и рисовал всю страницу в каждом кадре: на занятом или медленном
// компьютере кадры пропадали, а перенос шапки набора на вторую строку двигал сетку одним прыжком.
// Сдвиг и сжатие браузер рисует отдельно от скриптов и раскладки — движение не зависит от них.

/** Панель рядом с сеткой (без места во всю высоту): карточки сеток и детали строк с номерами страниц. */
const MOVING = ".icon-grid > li, .result-grid > li, .grid-bar > *";
/** Содержимое карточки — обратное сжатие, чтобы иконка и подписи не искажались. */
const CONTENT = ":scope > .icon-card-link > *, :scope.result-skeleton > *";

/**
 * Дети карточки, которые не растягиваются вместе с ней (lib/motion.ts):
 * - иконка и части скелетона стоят посередине — им хватает обратного сжатия, без замеров;
 * - подпись едет с прежнего места на новое: короткая стоит посередине, длинная с многоточием — от левого
 *   края, и начало текста не прыгает;
 * - кнопки «в рюкзак» и чекбокс — по верхним углам, и только когда видны: под курсором, в фокусе или у
 *   отмеченной карточки. У остальных карточек их нет на экране, и мерить нечего.
 */
const CARD_CONTENT: readonly ContentRule[] = [
  { selector: ":scope > .icon-card-link > svg, :scope.result-skeleton > *" },
  {
    selector:
      ":scope > .icon-card-link > :is(.icon-cell-name, .result-cell-text)",
    track: true,
  },
  {
    selector: ":scope:is(:hover, :focus-within) > .card-bag",
    x: "start",
    y: "start",
  },
  {
    selector:
      ":scope:is(:hover, :focus-within) > .card-check, :scope > .card-check.card-tool-on",
    x: "end",
    y: "start",
  },
];
/** Поле поиска: значок и текст — у левого края, подсказка «Ctrl K» — у правого. */
const FIELD_CONTENT: readonly ContentRule[] = [
  { selector: ":scope > .hero-field-icon", track: true, x: "start" },
  { selector: ":scope > .hero-input", track: true, x: "start" },
  { selector: ":scope > .hero-keys", track: true, x: "end" },
];

/** Что переезжает в левой колонке страницы, когда панель — во всю высоту (селекторы — от <main>). */
interface PageGroup {
  selector: string;
  content?: readonly ContentRule[];
  /** Элемент не сжимается: сразу нового размера, едет только его левый верхний угол (ряд чипсов, текст). */
  keepSize?: boolean;
  /** Элементы идут сверху вниз: первый ниже экрана — остальные не меряются. */
  ordered?: boolean;
  /** Элементы — в колонке каркаса, а не в <main> страницы: подвал. */
  column?: boolean;
}
const PAGE_GROUPS: readonly PageGroup[] = [
  {
    selector: ".icon-grid > li, .result-grid > li",
    content: CARD_CONTENT,
    ordered: true,
  },
  { selector: ".grid-field", content: FIELD_CONTENT },
  {
    selector:
      ".subscribe, .set-meta > li, .grid-toolbar > :not(.grid-search), .grid-bar > *, .select-bar > *",
  },
  {
    selector: ".grid-filters > *, .search-status, .grid-status",
    keepSize: true,
  },
  // Панель отодвигает подвал (решение владельца 23 ноября 2026): его группы ссылок доезжают на новые места,
  // правая в узкой колонке — на вторую строку.
  { selector: ".site-footer > .footer-group", keepSize: true, column: true },
];

/**
 * Запас сверху и снизу экрана: переезжает только то, что видно, и чуть дальше — на случай, когда шапка
 * набора переносится на вторую строку и сетка сдвигается на её высоту. Чем меньше анимаций, тем быстрее
 * щелчок: запуск каждой — работа в той же задаче.
 */
const NEAR = 64;
/** Метка анимаций перехода: новый переход отменяет недоигранный. */
const FLIP_ID = "iconavo-flip";
/** Метка выезда и ухода самой панели. */
const SLIDE_ID = "iconavo-panel-slide";
/** Копию убирает конец её анимации; это — запас, если анимации не было или она не кончилась. */
const LEAVE_FALLBACK_MS = 1000;
/** Телефон — как раскладка сайта (до 64rem): панель — шторка поверх страницы, раскладка не меняется. */
const DESKTOP = "(min-width: 64rem)";

/**
 * Класс панели, которая выезжает и уезжает сдвигом из-за правого края (панель во всю высоту на компьютере):
 * её движение запускает PanelLayout — в такт с краем колонки, — а не анимация в стилях (app/globals.css).
 */
const SLIDES = "panel-slides";

interface Leaving {
  node: HTMLElement;
  box: Box;
  scrollTop: number;
  /** Уезжает сдвигом вправо на столько пикселей; нет — анимацией ухода из стилей. */
  slide?: number;
}

interface Snapshot {
  groups: FlipGroup[];
  leaving: Leaving[];
  /** Панель во всю высоту: карточка, которая не должна сдвинуться (lib/panel-anchor.ts). */
  anchor: Anchor | undefined;
}

/** Опора держится дольше перехода на этот запас; без анимаций — столько. */
const HOLD_EXTRA_MS = 150;
const HOLD_STILL_MS = 100;

/** Копия уходящей панели (и затемнения на телефоне): без id, недоступная, со своим местом. */
function copyOf(element: HTMLElement, slide?: number): Leaving {
  const node = element.cloneNode(true) as HTMLElement;
  for (const each of [node, ...node.querySelectorAll("*")]) {
    each.removeAttribute("id");
  }
  node.removeAttribute("aria-labelledby");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("inert", "");
  node.classList.add("panel-leaving");
  if (slide !== undefined) node.classList.add(SLIDES);
  return {
    node,
    box: boxOf(element),
    scrollTop: element.scrollTop,
    ...(slide === undefined ? {} : { slide }),
  };
}

/**
 * Уходящая копия: на прежнем месте поверх страницы. Панель во всю высоту уезжает за правый край окна
 * сдвигом — вместе с краем колонки, которая возвращается на её место; остальное (панель рядом с сеткой,
 * шторка и затемнение на телефоне) — анимацией ухода из стилей (.panel-leaving).
 */
function playLeaving(root: HTMLElement, leaving: Leaving[], duration: number) {
  for (const { node, box, scrollTop, slide } of leaving) {
    node.style.setProperty("--leave-left", `${box.left}px`);
    node.style.setProperty("--leave-top", `${box.top}px`);
    node.style.setProperty("--leave-width", `${box.width}px`);
    node.style.setProperty("--leave-height", `${box.height}px`);
    root.append(node);
    node.scrollTop = scrollTop;
    const remove = () => node.remove();
    if (slide === undefined) {
      node.addEventListener("animationend", (e) => {
        if (e.target === node) remove();
      });
    } else {
      node
        .animate(slideFrames(slide, true), {
          duration,
          easing: "linear",
          fill: "forwards",
          id: SLIDE_ID,
        })
        .finished.then(remove, remove);
    }
    setTimeout(remove, LEAVE_FALLBACK_MS);
  }
}

/**
 * Раскладка «сетка + панель» (.with-panel): на компьютере панель — колонка справа, сетка сужается; на
 * телефоне — шторка поверх. Открытие и закрытие — с микроанимацией.
 */
export class PanelLayout extends Component<{
  open: boolean;
  /** Иконка панели: её карточка — опора, она остаётся на месте в окне (панель во всю высоту). */
  icon?: string | undefined;
  /**
   * Место панели вне раскладки (панель во всю высоту страницы, lib/panel-layout.ts): тогда раскладка не
   * делает колонку под панель, уходящую панель ищет там, а переезжает вся левая колонка страницы.
   */
  slot?: HTMLElement | null;
  children: ReactNode;
}> {
  private readonly root = createRef<HTMLDivElement>();

  componentDidMount() {
    // Длительность перехода — заранее, пока панель закрыта: при первом открытии её чтение шло бы до
    // удержания опоры (componentDidUpdate) и давало Chrome держать прокрутку самому.
    motionMs("--motion-panel-in", 240);
  }

  getSnapshotBeforeUpdate(
    previous: Readonly<{ open: boolean; icon?: string | undefined }>,
  ) {
    const root = this.root.current;
    if (previous.open === this.props.open || root === null) return null;
    const slot = this.props.slot ?? null;
    // Панель во всю высоту: карточка не сдвигается — и без анимаций (lib/panel-anchor.ts).
    const anchor = slot
      ? findAnchor(root, this.props.open ? this.props.icon : previous.icon)
      : undefined;
    if (reducedMotion()) {
      return { groups: [], leaving: [], anchor } satisfies Snapshot;
    }
    const groups: FlipGroup[] = [];
    const page = slot?.parentElement ?? null;
    if (page === null) {
      groups.push({ before: boxesNear(root, MOVING), content: CONTENT });
    } else if (window.matchMedia(DESKTOP).matches) {
      for (const group of PAGE_GROUPS) {
        const before = boxesNear(
          group.column ? (page.parentElement ?? page) : page,
          group.selector,
          NEAR,
          group.ordered === true,
        );
        groups.push({
          before,
          ...(group.content === undefined
            ? {}
            : {
                content: group.content,
                children: childBoxes(before, group.content),
              }),
          ...(group.keepSize ? { keepSize: true } : {}),
        });
      }
    }
    const leaving: Leaving[] = [];
    if (previous.open) {
      const home = slot ?? root;
      // Панель во всю высоту на компьютере уезжает на ширину своей колонки — вместе с полоской своего низа
      // у края окна (.panel-cover, app/globals.css).
      const slide =
        slot !== null && window.matchMedia(DESKTOP).matches
          ? slot.getBoundingClientRect().width
          : undefined;
      for (const element of home.querySelectorAll<HTMLElement>(
        ":scope > .icon-panel, :scope > .panel-backdrop, :scope > .panel-cover",
      )) {
        if (getComputedStyle(element).display !== "none") {
          leaving.push(
            copyOf(
              element,
              element.classList.contains("panel-backdrop") ? undefined : slide,
            ),
          );
        }
      }
    }
    return { groups, leaving, anchor } satisfies Snapshot;
  }

  componentDidUpdate(
    _previous: unknown,
    _state: unknown,
    snapshot: Snapshot | null,
  ) {
    const root = this.root.current;
    if (snapshot === null || root === null) return;
    // Из памяти: прочитана при монтировании (componentDidMount).
    const duration = motionMs("--motion-panel-in", 240);
    // Недоигранный переход — прочь: новые места меряются без его сдвигов.
    cancelFlip(FLIP_ID);
    // Опора — до первого чтения новой раскладки и стилей: удержание включает data-panel-anchor и тем
    // выключает «держание» прокрутки браузером. Раньше первым шло чтение высоты панели (ниже), а при первом
    // открытии — и длительности перехода: Firefox и Chrome успевали докрутить страницу сами, удержанию
    // сайта нечего было делать, и контрольная поломка «сетка прыгает» проверки сайта в Firefox иногда
    // не замечалась (18 ноября 2026, CI на main). Пользователь разницы не видит: карточка на месте.
    if (snapshot.anchor !== undefined) {
      holdAnchor(
        snapshot.anchor,
        reducedMotion() ? HOLD_STILL_MS : duration + HOLD_EXTRA_MS,
      );
    }
    const slot = this.props.slot ?? null;
    const panel =
      this.props.open && slot !== null
        ? slot.querySelector<HTMLElement>(":scope > .icon-panel")
        : null;
    // Высота панели по окну — сейчас, до запуска переезда: новая раскладка уже прочитана, а позже то же
    // чтение стоило бы лишнего пересчёта стилей (lib/panel-fit.ts).
    if (panel !== null) fitNow(panel);
    // Панель во всю высоту выезжает из-за правого края своей колонки — в такт с краем левой колонки, в
    // том же запуске, что и переезд: ширина колонки читается до первой анимации — чтение после них
    // заставило бы браузер пересчитать стили всех едущих элементов ещё раз.
    const extra: [HTMLElement, Keyframe[]][] = [];
    if (
      panel !== null &&
      slot !== null &&
      !reducedMotion() &&
      window.matchMedia(DESKTOP).matches
    ) {
      const width = slot.getBoundingClientRect().width;
      extra.push([panel, slideFrames(width)]);
      // Полоска низа панели у края окна выезжает вместе с ней: иначе её вырезы под углы стояли бы на месте,
      // а панель ехала бы под ними.
      const cover = slot.querySelector<HTMLElement>(":scope > .panel-cover");
      if (cover !== null) extra.push([cover, slideFrames(width)]);
    }
    playFlips(snapshot.groups, { id: FLIP_ID, duration }, extra);
    playLeaving(root, snapshot.leaving, duration);
  }

  render() {
    return (
      <div
        ref={this.root}
        className="with-panel"
        data-panel={this.props.open && !this.props.slot ? "" : undefined}
      >
        {this.props.children}
      </div>
    );
  }
}
