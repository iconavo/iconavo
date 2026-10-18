// Цвета монохромных наборов (ADR-0014): всё, что рисуется, берёт цвет текста (currentColor),
// прозрачность сохраняется, маски не перекрашиваются, фигуры без заливки получают цвет явно.

import { elements, idMap, refsOf } from "../svg/refs.js";
import type { SvgElement } from "../svg/serialize.js";
import { formatNumber } from "./canvas.js";

/** Свойства цвета и их прозрачность; у lighting-color прозрачности нет. */
const OPACITY_OF: ReadonlyMap<string, string | undefined> = new Map([
  ["fill", "fill-opacity"],
  ["stroke", "stroke-opacity"],
  ["stop-color", "stop-opacity"],
  ["flood-color", "flood-opacity"],
  ["lighting-color", undefined],
]);

/** Фигуры, которым нужна заливка; <line> не заливается. */
const FILLED: ReadonlySet<string> = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polyline",
  "polygon",
  "use",
]);

/** Внутри них фигуры красит тот, кто на них ссылается (<use>), или цвет не нужен (clipPath, mask). */
const BORROWING: ReadonlySet<string> = new Set([
  "defs",
  "symbol",
  "clipPath",
  "mask",
]);

/** Элементы, которые рисуются только по ссылке: обход по месту в них не заходит. */
const BY_REFERENCE: ReadonlySet<string> = new Set([
  ...BORROWING,
  "pattern",
  "marker",
  "linearGradient",
  "radialGradient",
  "filter",
]);

/** Сложное для монохромной иконки: результат стоит посмотреть глазами. */
const COMPLEX: ReadonlySet<string> = new Set([
  "mask",
  "pattern",
  "marker",
  "linearGradient",
  "radialGradient",
  "filter",
]);

/** Цвет заливки в фильтрах; как и stop-color, не наследуется и по умолчанию чёрный. */
const FLOODS: ReadonlySet<string> = new Set(["feFlood", "feDropShadow"]);

/** Значения, которые не меняются: это не цвет. */
const KEEP: ReadonlySet<string> = new Set([
  "none",
  "currentcolor",
  "inherit",
  "context-fill",
  "context-stroke",
]);

/** Основной цвет иконки: currentColor, чёрный и цвет по умолчанию считаются одним цветом. */
export const FOREGROUND = "основной";

export interface Rgba {
  /** Цвет без прозрачности: `#rrggbb`. */
  rgb: string;
  /** Непрозрачность от 0 до 1. */
  alpha: number;
}

const NUM = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
const CHANNEL = new RegExp(`^(${NUM})(%?)$`);
const HUE = new RegExp(`^(${NUM})(?:deg)?$`);
const NAMED: ReadonlyMap<string, string> = new Map([
  ["black", "#000000"],
  ["white", "#ffffff"],
]);

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/** Число или процент: «50%» при max = 255 — 127,5. */
function channel(text: string, max: number): number | undefined {
  const m = CHANNEL.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] ? (n / 100) * max : n;
}

function hslToRgb(h: number, s: number, l: number): number[] {
  const hue = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const toHex = (rgb: number[]) =>
  `#${rgb
    .map((c) =>
      Math.round(clamp(c, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/**
 * Разбор цвета: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla() (через запятые и через
 * пробелы с «/ прозрачность»), black и white. Другие имена — undefined: они считаются по написанию.
 */
export function parseColor(value: string): Rgba | undefined {
  const v = value.trim().toLowerCase();
  const named = NAMED.get(v);
  if (named) return { rgb: named, alpha: 1 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    return {
      rgb: `#${full.slice(0, 6)}`,
      alpha: full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1,
    };
  }
  const fn = /^(rgba?|hsla?)\(\s*(.*?)\s*\)$/.exec(v);
  if (!fn) return undefined;
  const [, kind = "", inner = ""] = fn;
  let parts: string[];
  let alphaText: string | undefined;
  if (inner.includes(",")) {
    parts = inner.split(/\s*,\s*/);
    if (parts.length === 4) alphaText = parts.pop();
  } else {
    const [main = "", alpha, ...extra] = inner.split(/\s*\/\s*/);
    if (extra.length > 0) return undefined;
    parts = main.split(/\s+/);
    alphaText = alpha;
  }
  if (parts.length !== 3) return undefined;
  const alpha = alphaText === undefined ? 1 : channel(alphaText, 1);
  if (alpha === undefined) return undefined;
  let rgb: (number | undefined)[];
  if (kind.startsWith("rgb")) {
    rgb = parts.map((p) => channel(p, 255));
  } else {
    const h = HUE.exec(parts[0] ?? "")?.[1];
    const s = channel(parts[1] ?? "", 100);
    const l = channel(parts[2] ?? "", 100);
    if (h === undefined || s === undefined || l === undefined) return undefined;
    rgb = hslToRgb(Number(h), clamp(s / 100, 0, 1), clamp(l / 100, 0, 1));
  }
  if (rgb.some((c) => c === undefined)) return undefined;
  return { rgb: toHex(rgb as number[]), alpha: clamp(alpha, 0, 1) };
}

type Paint =
  | { kind: "keep" }
  | { kind: "transparent" }
  | { kind: "url"; url: string; fallback?: string }
  | { kind: "color"; value: string };

function classify(raw: string): Paint {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (KEEP.has(lower)) return { kind: "keep" };
  if (lower === "transparent") return { kind: "transparent" };
  const url = /^(url\(#[^)]+\))(?:\s+(.+))?$/i.exec(value);
  if (url) return { kind: "url", url: url[1] ?? "", fallback: url[2] };
  return { kind: "color", value };
}

/** Цвет для подсчёта: currentColor раскрывается через ближайший атрибут color; none и ссылки не считаются. */
function tokenOf(raw: string, color: string | undefined): string | undefined {
  const paint = classify(raw);
  if (paint.kind === "keep") {
    if (raw.trim().toLowerCase() !== "currentcolor") return undefined;
    return color === undefined
      ? FOREGROUND
      : (tokenOf(color, undefined) ?? FOREGROUND);
  }
  if (paint.kind !== "color") return undefined;
  const parsed = parseColor(paint.value);
  if (!parsed) return paint.value.toLowerCase();
  return parsed.rgb === "#000000" ? FOREGROUND : parsed.rgb;
}

/** Непрозрачность из атрибута: число или процент; без атрибута — 1. */
function opacityOf(value: string | undefined): number {
  if (value === undefined) return 1;
  const n = channel(value.trim(), 1);
  return n === undefined ? 1 : clamp(n, 0, 1);
}

export interface PaintStats {
  /** Сколько значений цвета заменено на currentColor (и удалено атрибутов color). */
  replaced: number;
  /** Сколько элементов получили цвет по умолчанию: фигуры, точки градиентов, заливки фильтров. */
  defaults: number;
  /** Из фигур, получивших заливку, — с обводкой: в оригинале они тоже залиты, но стоит взглянуть. */
  strokedFilled: number;
  /** Разные цвета до перекраски, по алфавиту; больше одного — иконку стоит посмотреть. */
  colors: string[];
  /** Сложные элементы в иконке: маски, градиенты, узоры, маркеры, фильтры. */
  complex: string[];
  warnings: string[];
}

interface Inherited {
  /** Исходные (до перекраски) fill, stroke и color — для масок и подсчёта цветов. */
  fill?: string;
  stroke?: string;
  color?: string;
  /** Заливка задана на элементе или выше. */
  filled: boolean;
  /** Обводка задана и не none. */
  stroked: boolean;
  /** Внутри defs, symbol, clipPath или mask: цвет даёт ссылающийся элемент. */
  borrowing: boolean;
}

/** Всё, что рисуется внутри масок (по месту и по ссылкам из них): цвет там задаёт прозрачность. */
function maskContent(
  all: readonly SvgElement[],
  byId: ReadonlyMap<string, SvgElement>,
): Set<SvgElement> {
  const inMask = new Set<SvgElement>();
  const queue = all.filter((el) => el.tag === "mask");
  while (queue.length > 0) {
    for (const el of elements(queue.pop() as SvgElement)) {
      if (inMask.has(el)) continue;
      inMask.add(el);
      for (const [name, value] of Object.entries(el.attrs)) {
        for (const id of refsOf(name, value)) {
          const target = byId.get(id);
          if (target && !inMask.has(target)) queue.push(target);
        }
      }
    }
  }
  return inMask;
}

/** Всё, что рисуется в самой иконке: по месту и по ссылкам, кроме обрезки и масок. */
function drawnContent(
  root: SvgElement,
  byId: ReadonlyMap<string, SvgElement>,
): Set<SvgElement> {
  const drawn = new Set<SvgElement>();
  const stack: SvgElement[] = [root];
  while (stack.length > 0) {
    const el = stack.pop() as SvgElement;
    if (drawn.has(el)) continue;
    drawn.add(el);
    for (const [name, value] of Object.entries(el.attrs)) {
      if (name === "clip-path" || name === "mask") continue;
      for (const id of refsOf(name, value)) {
        const target = byId.get(id);
        if (target) stack.push(target);
      }
    }
    for (const child of el.children) {
      if (!BY_REFERENCE.has(child.tag)) stack.push(child);
    }
  }
  return drawn;
}

/** Перекрашивает дерево монохромной иконки на месте и возвращает, что сделано. */
export function normalizePaint(root: SvgElement): PaintStats {
  const all = elements(root);
  const byId = idMap(all);
  const inMask = maskContent(all, byId);
  const drawn = drawnContent(root, byId);
  const inClip = new Set(
    all.filter((el) => el.tag === "clipPath").flatMap((el) => elements(el)),
  );
  const stats: PaintStats = {
    replaced: 0,
    defaults: 0,
    strokedFilled: 0,
    colors: [],
    complex: [],
    warnings: [],
  };
  const colors = new Set<string>();
  const complex = new Set<string>();
  const warnings = new Set<string>();
  if ([...inMask].some((el) => drawn.has(el))) {
    warnings.add(
      "элемент рисуется и в маске, и в иконке — его цвет не менялся",
    );
  }

  const set = (el: SvgElement, name: string, value: string) => {
    el.attrs[name] = value;
  };

  /** Заменяет цвет в одном свойстве; при неудаче оставляет как было и предупреждает. */
  const recolor = (el: SvgElement, prop: string, raw: string) => {
    const paint = classify(raw);
    if (paint.kind === "keep") return;
    if (paint.kind === "url") {
      const fallback = paint.fallback && classify(paint.fallback);
      if (!fallback || fallback.kind === "keep") return;
      set(
        el,
        prop,
        `${paint.url} ${fallback.kind === "transparent" ? "none" : "currentColor"}`,
      );
      stats.replaced++;
      return;
    }
    const opacity = OPACITY_OF.get(prop);
    if (paint.kind === "transparent") {
      if (prop === "fill" || prop === "stroke") {
        set(el, prop, "none");
      } else if (opacity !== undefined) {
        set(el, prop, "currentColor");
        set(el, opacity, "0");
      } else {
        warnings.add(`прозрачный ${prop} — цвет оставлен как есть`);
        return;
      }
      stats.replaced++;
      return;
    }
    const alpha = parseColor(paint.value)?.alpha ?? 1;
    if (alpha < 1) {
      // Прозрачность наследуется: на группе её нельзя перенести, не задев детей со своими цветами.
      const container = el.children.length > 0 || el.tag === "use";
      if (opacity === undefined || container) {
        warnings.add("полупрозрачный цвет на группе — цвет оставлен как есть");
        return;
      }
      set(el, opacity, formatNumber(opacityOf(el.attrs[opacity]) * alpha));
    }
    set(el, prop, "currentColor");
    stats.replaced++;
  };

  const visit = (el: SvgElement, inherited: Inherited) => {
    const own = {
      fill: el.attrs.fill,
      stroke: el.attrs.stroke,
      color: el.attrs.color,
    };
    // Маска берёт цвета у предков: закрепляем исходные, чтобы перекраска выше её не задела.
    if (el.tag === "mask") {
      for (const prop of ["fill", "stroke", "color"] as const) {
        const value = inherited[prop];
        if (el.attrs[prop] === undefined && value !== undefined)
          set(el, prop, value);
      }
    }
    const keep = inMask.has(el) || inClip.has(el);
    const color = own.color ?? inherited.color;
    if (!keep) {
      for (const prop of OPACITY_OF.keys()) {
        const value = el.attrs[prop];
        if (value === undefined) continue;
        const token = tokenOf(value, color);
        if (token !== undefined) colors.add(token);
        recolor(el, prop, value);
      }
      if (own.color !== undefined) {
        el.attrs = Object.fromEntries(
          Object.entries(el.attrs).filter(([key]) => key !== "color"),
        );
        stats.replaced++;
      }
    }

    const fillSet =
      own.fill !== undefined && own.fill.trim().toLowerCase() !== "inherit";
    const strokeSet =
      own.stroke !== undefined && own.stroke.trim().toLowerCase() !== "inherit";
    const next: Inherited = {
      fill: own.fill ?? inherited.fill,
      stroke: own.stroke ?? inherited.stroke,
      color: own.color ?? inherited.color,
      filled: inherited.filled || fillSet,
      stroked: strokeSet
        ? (own.stroke as string).trim().toLowerCase() !== "none"
        : inherited.stroked,
      borrowing:
        el.tag === "pattern" || el.tag === "marker"
          ? false
          : inherited.borrowing || BORROWING.has(el.tag),
    };

    if (!keep) {
      if (FILLED.has(el.tag) && !next.filled && !next.borrowing) {
        set(el, "fill", "currentColor");
        colors.add(FOREGROUND);
        stats.defaults++;
        if (next.stroked) stats.strokedFilled++;
      }
      if (el.tag === "stop" && el.attrs["stop-color"] === undefined) {
        set(el, "stop-color", "currentColor");
        colors.add(FOREGROUND);
        stats.defaults++;
      }
      if (FLOODS.has(el.tag) && el.attrs["flood-color"] === undefined) {
        set(el, "flood-color", "currentColor");
        stats.defaults++;
      }
    }
    if (COMPLEX.has(el.tag)) complex.add(el.tag);
    for (const child of el.children) visit(child, next);
  };
  visit(root, { filled: false, stroked: false, borrowing: false });

  stats.colors = [...colors].sort();
  stats.complex = [...complex].sort();
  stats.warnings = [...warnings];
  return stats;
}
