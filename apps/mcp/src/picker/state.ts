// Состояние сетки выбора (ADR-0045): чистые функции без DOM — их проверяют тесты в Node. Решения владельца
// 20 ноября 2026 после проверки в Claude и ChatGPT: без переключателя стиля и надписей; цвет, толщина линии
// и формат кода выбираются в сетке, и «Select» сразу просит у ассистента код этого формата.

import type { Format } from "@iconavo-ui/snippets/look";
import type { PickerCard, PickerPayload } from "@iconavo-ui/snippets/picker";
import { parseColor } from "@iconavo-ui/snippets/settings";

/** Что показывает сетка. */
export type Status =
  | "waiting"
  | "ready"
  | "empty"
  | "error"
  | "cancelled"
  | "fallback";

/** Что с выбором: ещё не отправлен, уходит, ушёл в чат. */
export type Delivery = "idle" | "sending" | "sent";

export interface PickerState {
  status: Status;
  payload?: PickerPayload;
  /** Вид кода — кнопка формата. */
  format: Format;
  /** Свой цвет #rrggbb; нет — «Auto», цвет текста чата. */
  color?: string;
  /** Своя толщина линии; нет — как у рисунка. */
  stroke?: number;
  /** Номер выбранной карточки. */
  selected?: number;
  delivery: Delivery;
  /** Текст ошибки сервера. */
  error?: string;
  /** Картинка-сетка из обычной части ответа — когда данных сетки нет. */
  image?: string;
}

export const initialState = (): PickerState => ({
  status: "waiting",
  format: "html",
  delivery: "idle",
});

/** Ответ инструмента: формат и цвет — те, что передал ассистент. */
export function withPayload(s: PickerState, p: PickerPayload): PickerState {
  const color = p.color === undefined ? undefined : parseColor(p.color);
  return {
    status: p.cards.length === 0 ? "empty" : "ready",
    payload: p,
    format: p.format,
    ...(color === undefined ? {} : { color }),
    delivery: "idle",
    ...(s.image === undefined ? {} : { image: s.image }),
  };
}

export const cardOf = (s: PickerState, n: number): PickerCard | undefined =>
  s.payload?.cards.find((card) => card.n === n);

/** Любое изменение снова разрешает «Select». */
export function selectCard(s: PickerState, n: number): PickerState {
  if (cardOf(s, n) === undefined) return s;
  return { ...s, selected: n, delivery: "idle" };
}

export const setFormat = (s: PickerState, format: Format): PickerState => ({
  ...s,
  format,
  delivery: "idle",
});

export function setColor(
  s: PickerState,
  color: string | undefined,
): PickerState {
  const { color: _, ...rest } = s;
  return {
    ...rest,
    ...(color === undefined ? {} : { color }),
    delivery: "idle",
  };
}

export function setStroke(
  s: PickerState,
  stroke: number | undefined,
): PickerState {
  const { stroke: _, ...rest } = s;
  return {
    ...rest,
    ...(stroke === undefined ? {} : { stroke }),
    delivery: "idle",
  };
}

export interface GridCell {
  n: number;
  available: boolean;
}

/**
 * Куда идёт фокус по стрелке в сетке из cols колонок: вправо и влево — соседняя карточка, вверх и вниз —
 * через ряд, Home и End — первая и последняя. Недоступные пропускаются; дальше края — никуда.
 */
export function moveTo(
  cells: readonly GridCell[],
  from: number,
  key: string,
  cols: number,
): number | undefined {
  const i = cells.findIndex((c) => c.n === from);
  if (i < 0) return undefined;
  const pick = (start: number, step: number): number | undefined => {
    for (let j = start; j >= 0 && j < cells.length; j += step) {
      const cell = cells[j] as GridCell;
      if (cell.available) return cell.n;
    }
    return undefined;
  };
  switch (key) {
    case "ArrowRight":
      return pick(i + 1, 1);
    case "ArrowLeft":
      return pick(i - 1, -1);
    case "ArrowDown":
      return pick(i + cols, cols);
    case "ArrowUp":
      return pick(i - cols, -cols);
    case "Home":
      return pick(0, 1);
    case "End":
      return pick(cells.length - 1, -1);
    default:
      return undefined;
  }
}
