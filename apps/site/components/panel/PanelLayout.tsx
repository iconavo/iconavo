"use client";

import { Component, createRef, type ReactNode } from "react";
import type { Box } from "../../lib/flip";
import { boxOf, motionMs, playFlip, reducedMotion } from "../../lib/motion";
import { type Anchor, findAnchor, holdAnchor } from "../../lib/panel-anchor";

// Микроанимация открытия и закрытия панели иконки (решение владельца 12 ноября 2026). Панель
// открывается и закрывается и через историю браузера (✕ и Esc уходят «назад»), поэтому переход
// запускается не из щелчка, а здесь — по смене open, как бы она ни случилась.
// - getSnapshotBeforeUpdate: старая раскладка ещё на экране — запоминаются места карточек и деталей
//   строк над и под сеткой, а при закрытии — копия панели.
// - componentDidUpdate: новая раскладка записана — элементы переходят со старых мест на новые
//   (lib/motion.ts, Web Animations API), копия панели уходит и удаляется.
// Появление самой панели — анимация в стилях (.icon-panel, app/globals.css). «Уменьшить движение» в
// системе — без анимаций.

/** Что переезжает: карточки сеток и детали строк с номерами страниц. */
const MOVING = ".icon-grid > li, .result-grid > li, .grid-bar > *";
/** Содержимое карточки — обратное сжатие, чтобы иконка и подписи не искажались. */
const CONTENT = ":scope > .icon-card-link > *, :scope.result-skeleton > *";
/** Метка анимаций перехода: новый переход отменяет недоигранный. */
const FLIP_ID = "iconavo-flip";
/** Копию убирает конец её анимации; это — запас, если анимации не было или она не кончилась. */
const LEAVE_FALLBACK_MS = 1000;

interface Leaving {
  node: HTMLElement;
  box: Box;
  scrollTop: number;
}

interface Snapshot {
  boxes: Map<HTMLElement, Box>;
  leaving: Leaving[];
  /** Панель во всю высоту: карточка, которая не должна сдвинуться (lib/panel-anchor.ts). */
  anchor: Anchor | undefined;
}

/** Опора держится дольше перехода колонок на этот запас; без анимаций — столько. */
const HOLD_EXTRA_MS = 150;
const HOLD_STILL_MS = 100;

/** Копия уходящей панели (и затемнения на телефоне): без id, недоступная, со своим местом. */
function copyOf(element: HTMLElement): Leaving {
  const node = element.cloneNode(true) as HTMLElement;
  for (const each of [node, ...node.querySelectorAll("*")]) {
    each.removeAttribute("id");
  }
  node.removeAttribute("aria-labelledby");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("inert", "");
  node.classList.add("panel-leaving");
  return { node, box: boxOf(element), scrollTop: element.scrollTop };
}

/** Уходящая копия: на прежнем месте поверх страницы, анимация ухода — в стилях (.panel-leaving). */
function playLeaving(root: HTMLElement, leaving: Leaving[]) {
  for (const { node, box, scrollTop } of leaving) {
    node.style.setProperty("--leave-left", `${box.left}px`);
    node.style.setProperty("--leave-top", `${box.top}px`);
    node.style.setProperty("--leave-width", `${box.width}px`);
    node.style.setProperty("--leave-height", `${box.height}px`);
    root.append(node);
    node.scrollTop = scrollTop;
    const remove = () => node.remove();
    node.addEventListener("animationend", (e) => {
      if (e.target === node) remove();
    });
    setTimeout(remove, LEAVE_FALLBACK_MS);
  }
}

/**
 * Раскладка «сетка + панель» (.with-panel): на компьютере панель — колонка справа, сетка сужается; на
 * телефоне — шторка поверх. Открытие и закрытие — с микроанимацией.
 */
export class PanelLayout extends Component<{
  open: boolean;
  /** Иконка панели: её карточка — опора, пока колонки переходят (панель во всю высоту). */
  icon?: string | undefined;
  /**
   * Место панели вне раскладки (панель во всю высоту страницы, lib/panel-layout.ts): тогда раскладка не
   * делает колонку под панель, а уходящую панель ищет там.
   */
  slot?: HTMLElement | null;
  children: ReactNode;
}> {
  private readonly root = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(
    previous: Readonly<{ open: boolean; icon?: string | undefined }>,
  ) {
    const root = this.root.current;
    if (previous.open === this.props.open || root === null) return null;
    // Панель во всю высоту: карточка не сдвигается — и без анимаций (lib/panel-anchor.ts).
    const anchor = this.props.slot
      ? findAnchor(root, this.props.open ? this.props.icon : previous.icon)
      : undefined;
    if (reducedMotion()) {
      return { boxes: new Map(), leaving: [], anchor } satisfies Snapshot;
    }
    // Панель во всю высоту страницы (slot) сдвигает раскладку сама — переходом колонок в стилях, без
    // анимации карточек (app/globals.css).
    const boxes = new Map<HTMLElement, Box>();
    if (!this.props.slot) {
      for (const element of root.querySelectorAll<HTMLElement>(MOVING)) {
        boxes.set(element, boxOf(element));
      }
    }
    const leaving: Leaving[] = [];
    if (previous.open) {
      const home = this.props.slot ?? root;
      for (const element of home.querySelectorAll<HTMLElement>(
        ":scope > .icon-panel, :scope > .panel-backdrop",
      )) {
        if (getComputedStyle(element).display !== "none") {
          leaving.push(copyOf(element));
        }
      }
    }
    return { boxes, leaving, anchor } satisfies Snapshot;
  }

  componentDidUpdate(
    _previous: unknown,
    _state: unknown,
    snapshot: Snapshot | null,
  ) {
    const root = this.root.current;
    if (snapshot === null || root === null) return;
    if (snapshot.anchor !== undefined) {
      holdAnchor(
        snapshot.anchor,
        reducedMotion()
          ? HOLD_STILL_MS
          : motionMs("--motion-panel-in", 240) + HOLD_EXTRA_MS,
      );
    }
    playFlip(snapshot.boxes, {
      id: FLIP_ID,
      duration: motionMs("--motion-panel-in", 240),
      content: CONTENT,
    });
    playLeaving(root, snapshot.leaving);
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
