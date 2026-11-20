// Состояние сетки выбора (ADR-0045): чистые функции без DOM — их проверяют тесты в Node. Решения владельца
// 20 ноября 2026: переключатель стиля меняет все карточки сразу, а карточки без выбранного стиля
// приглушены и недоступны — сетка не прыгает.

import {
  cardName,
  type PickerCard,
  type PickerPayload,
  type PickerStyle,
  pickerStyles,
} from "@iconavo-ui/snippets/picker";
import { parseColor } from "@iconavo-ui/snippets/settings";

/** Что показывает сетка. */
export type Status =
  | "waiting"
  | "ready"
  | "empty"
  | "error"
  | "cancelled"
  | "fallback";

/** Что с выбором: ещё не отправлен, уходит, ушёл, клиент не принял — подсказка сказать имя. */
export type Delivery = "idle" | "sending" | "sent" | "tell";

export interface PickerState {
  status: Status;
  query: string;
  payload?: PickerPayload;
  style: PickerStyle;
  /** Свой цвет #rrggbb; нет — «Авто», цвет текста чата. */
  color?: string;
  /** Номер выбранной карточки. */
  selected?: number;
  delivery: Delivery;
  /** Имя, которое человек скажет ассистенту, если сообщение не ушло. */
  told?: string;
  /** Текст ошибки сервера. */
  error?: string;
  /** Картинка-сетка из обычной части ответа — когда данных сетки нет. */
  image?: string;
}

export const initialState = (): PickerState => ({
  status: "waiting",
  query: "",
  style: "any",
  delivery: "idle",
});

/** Запрос пришёл раньше ответа: показываем его, пока ищем. */
export const withQuery = (s: PickerState, query: string): PickerState =>
  s.status === "waiting" ? { ...s, query } : s;

/** Ответ инструмента: стиль — тот, которым ассистент сузил поиск, иначе «Любой». */
export function withPayload(s: PickerState, p: PickerPayload): PickerState {
  const styles = pickerStyles(p);
  const color = p.color === undefined ? undefined : parseColor(p.color);
  return {
    status: p.cards.length === 0 ? "empty" : "ready",
    query: p.query,
    payload: p,
    style: p.style !== undefined && styles.includes(p.style) ? p.style : "any",
    ...(color === undefined ? {} : { color }),
    delivery: "idle",
    ...(s.image === undefined ? {} : { image: s.image }),
  };
}

export const cardOf = (s: PickerState, n: number): PickerCard | undefined =>
  s.payload?.cards.find((card) => card.n === n);

/** Есть ли у карточки выбранный стиль. */
export const isAvailable = (s: PickerState, card: PickerCard): boolean =>
  s.payload !== undefined && cardName(s.payload, card, s.style) !== undefined;

export function selectCard(s: PickerState, n: number): PickerState {
  const card = cardOf(s, n);
  if (card === undefined || !isAvailable(s, card)) return s;
  return { ...s, selected: n, delivery: "idle" };
}

/** Другой стиль: выбранная карточка без него перестаёт быть выбранной. */
export function setStyle(s: PickerState, style: PickerStyle): PickerState {
  const next: PickerState = { ...s, style, delivery: "idle" };
  const card = s.selected === undefined ? undefined : cardOf(s, s.selected);
  if (card !== undefined && !isAvailable(next, card)) {
    const { selected: _, ...rest } = next;
    return rest;
  }
  return next;
}

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
