// Боковые панели страницы — рюкзак (lib/bag.ts) и настройки сетки (lib/grid-settings.ts): одна панель на
// страницу у каждой, открыта ли — только в памяти вкладки, после перезагрузки панели закрыты. Справа
// они занимают одно место, поэтому открытой бывает только одна (решение владельца 23 ноября 2026):
// открытие одной закрывает другую. Кнопка, которая открыла закрытую так панель, забывается — фокус
// уходит в новую панель, а не возвращается на её кнопку. Открывают и закрывают <dialog> панелей
// useSidePanel (закрытие — с анимацией) и useCloseOnOutsideClick (щелчок мимо).

import { type RefObject, useEffect, useSyncExternalStore } from "react";
import { reducedMotion } from "./motion";

/** Телефон — как раскладка сайта (до 64rem): вместо панели справа — шторка снизу с затемнением. */
export const PHONE = "(max-width: 63.98rem)";

export interface PanelStore {
  get(): boolean;
  /**
   * Открыть или закрыть; opener — кнопка, которой вернуть фокус после закрытия. Передаётся явно: Safari
   * при щелчке не даёт кнопке фокус, и document.activeElement её бы не знал.
   */
  set(open: boolean, opener?: HTMLElement): void;
  /** Кнопка, которая открыла панель, — забирается один раз. */
  takeOpener(): HTMLElement | null;
  subscribe(listener: () => void): () => void;
}

const panels: PanelStore[] = [];

export function createPanelStore(): PanelStore {
  let open = false;
  let opener: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const store: PanelStore = {
    get: () => open,
    set(next, by) {
      if (by !== undefined) opener = by;
      if (next === open) return;
      if (next) {
        for (const other of panels) {
          if (other === store || !other.get()) continue;
          other.takeOpener();
          other.set(false);
        }
      }
      open = next;
      for (const listener of listeners) listener();
    },
    takeOpener() {
      const el = opener;
      opener = null;
      return el;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  panels.push(store);
  return store;
}

/** Открыта ли панель; на сервере — закрыта. */
export function usePanelOpen(store: PanelStore): boolean {
  return useSyncExternalStore(store.subscribe, store.get, () => false);
}

/**
 * Панели на экране — вместе с теми, что ещё уезжают. Пока есть хоть одна, у <html> — data-side-panel:
 * полоса прокрутки страницы спрятана, и панель встаёт вплотную к краю окна (globals.css). Ширина полосы
 * замеряется до того, как она спрячется (--side-page-lane): столько же отдаётся полю справа, и страница не
 * сдвигается — при любой полосе (Firefox с обычными полосами, сенсорный экран). Отметка одна на обе
 * панели: пока одна уезжает, а другая выезжает, полоса не появляется и ширина не замеряется заново.
 */
const shown = new Set<string>();

function markShown(id: string) {
  const root = document.documentElement;
  if (shown.size === 0) {
    root.style.setProperty(
      "--side-page-lane",
      `${window.innerWidth - root.clientWidth}px`,
    );
    root.dataset.sidePanel = "";
  }
  shown.add(id);
}

function markHidden(id: string) {
  shown.delete(id);
  if (shown.size > 0) return;
  const root = document.documentElement;
  delete root.dataset.sidePanel;
  root.style.removeProperty("--side-page-lane");
}

/** Закрытия, которые ещё идут: у каждого — его отмена. */
const closing = new WeakMap<HTMLDialogElement, () => void>();

/** Запас, если конец анимации не пришёл (вкладка в фоне, стили не успели): панель всё равно закрывается. */
const CLOSE_FALLBACK_MS = 600;

/**
 * Закрыть с анимацией (решение владельца 23 ноября 2026): у <dialog> — data-closing, и стили увозят панель
 * вправо, а шторку — вниз, затемнение гаснет (globals.css); по концу анимации — close(). При «уменьшить
 * движение» — сразу.
 */
function closeAnimated(el: HTMLDialogElement, done: () => void): void {
  if (reducedMotion()) {
    el.close();
    done();
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onEnd = (e: AnimationEvent) => {
    // Свои анимации у детей и у затемнения (::backdrop) — не в счёт.
    if (e.target === el && e.pseudoElement === "") finish();
  };
  const stop = () => {
    clearTimeout(timer);
    el.removeEventListener("animationend", onEnd);
    delete el.dataset.closing;
    closing.delete(el);
  };
  const finish = () => {
    stop();
    el.close();
    done();
  };
  el.addEventListener("animationend", onEnd);
  timer = setTimeout(finish, CLOSE_FALLBACK_MS);
  el.dataset.closing = "";
  closing.set(el, stop);
}

/**
 * Открыть и закрыть <dialog> боковой панели по её хранилищу: на компьютере — немодально, на телефоне —
 * модально, с затемнением. При открытии фокус — на заголовок; при закрытии — на кнопку, которая открыла:
 * у немодальной панели сразу, пока она уезжает, у шторки — после закрытия (страница за затемнением до
 * того недоступна). Открыли снова, пока панель уезжает, — она остаётся на месте.
 */
export function useSidePanel(
  open: boolean,
  dialog: RefObject<HTMLDialogElement | null>,
  heading: RefObject<HTMLElement | null>,
  store: PanelStore,
  id: string,
): void {
  useEffect(() => {
    const el = dialog.current;
    if (el === null) return;
    if (open) {
      closing.get(el)?.();
      markShown(id);
      if (!el.open) {
        if (window.matchMedia(PHONE).matches) el.showModal();
        else el.show();
      }
      heading.current?.focus();
      return;
    }
    if (!el.open || closing.has(el)) return;
    const opener = store.takeOpener();
    opener?.focus();
    closeAnimated(el, () => {
      markHidden(id);
      const active = document.activeElement;
      if (
        opener !== null &&
        (active === null || active === document.body || el.contains(active))
      ) {
        opener.focus();
      }
    });
  }, [open, dialog, heading, store, id]);
}

/**
 * Щелчок мимо панели закрывает её (решения владельца 23 ноября 2026 — сначала у настроек, затем и у
 * рюкзака): на компьютере панели немодальные, и нажатие на сетку, строку поиска или панель иконки убирает
 * панель, а само нажатие срабатывает. Фокус остаётся там, куда щёлкнули: кнопка панели забывается, и
 * панель уезжает, не трогая фокус. Кнопки панели (aria-controls с её id) открывают и закрывают её сами. На
 * телефоне мимо шторки — затемнение: это щелчок по самому <dialog>, его обрабатывает панель.
 */
export function useCloseOnOutsideClick(
  open: boolean,
  dialog: RefObject<HTMLDialogElement | null>,
  store: PanelStore,
  id: string,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = dialog.current;
      const target = e.target;
      if (el === null || !(target instanceof Element) || el.contains(target)) {
        return;
      }
      const button = target.closest("button");
      if (button?.getAttribute("aria-controls") === id) return;
      store.takeOpener();
      store.set(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, dialog, store, id]);
}

/** Цель события — внутри открытого меню (role="menu" у меню Radix). */
export function inMenu(target: EventTarget | null): boolean {
  for (
    let node = target instanceof Element ? target : null;
    node !== null;
    node = node.parentElement
  ) {
    if (node.getAttribute("role") === "menu") return true;
  }
  return false;
}

/**
 * Esc закрывает панель первой — раньше панели иконки (та слушает всплытие и пропускает обработанное). Но
 * открытое меню (фокус в нём — например, «Icons per page ▾» рядом с немодальной панелью) — ещё раньше:
 * Esc закрывает его, а панель остаётся; раньше панель перехватывала Esc в фазе захвата, и меню оставалось
 * открытым (ревизия фазы 5, С-25).
 */
export function useCloseOnEscape(open: boolean, store: PanelStore): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || inMenu(e.target)) return;
      e.preventDefault();
      store.set(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, store]);
}
