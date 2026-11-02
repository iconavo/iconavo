// Настройки превью иконки (шаг 4 фазы 4, ADR-0041, ADR-0042): размер, цвет, толщина линии, поворот и
// отражение. Решение владельца 2 ноября 2026: настройки остаются, пока человек листает иконки в панели,
// и переходят на страницу иконки через адрес (?size=48&color=e11d48&stroke=1.5&rotate=90&flip=horizontal).
// Хранилище одно на вкладку — у панели и страницы; адрес читается только после гидратации, поэтому
// серверный HTML — с настройками по умолчанию. Значения — те, что понимает пакет (ADR-0031): поворот
// четвертями, отражение по горизонтали и вертикали.

import { useSyncExternalStore } from "react";

export type Quarter = 0 | 1 | 2 | 3;

export interface IconSettings {
  /** Размер превью в пикселях. */
  size: number;
  /** Свой цвет #rrggbb; нет — цвет текста вокруг. */
  color?: string;
  /** Своя толщина линии; нет — как у рисунка. */
  stroke?: number;
  rotate: Quarter;
  hflip: boolean;
  vflip: boolean;
}

export const SIZE_MIN = 16;
export const SIZE_MAX = 256;
export const SIZE_STEP = 8;
export const STROKE_MIN = 0.5;
export const STROKE_MAX = 3;
export const STROKE_STEP = 0.25;
/** Толщина линии Lucide и Tabler: с неё начинается ползунок. */
export const STROKE_DEFAULT = 2;
/** Цвет, с которого начинается выбор своего, пока человек его не поменял. */
export const COLOR_START = "#2563eb";

export const DEFAULT_SETTINGS: IconSettings = {
  size: 48,
  rotate: 0,
  hflip: false,
  vflip: false,
};

const HEX = /^#?([0-9a-f]{6})$/i;

/** Цвет из адреса или поля: #rrggbb строчными; не цвет — undefined. */
export function parseColor(value: string | null): string | undefined {
  const m = HEX.exec(value ?? "");
  return m ? `#${(m[1] as string).toLowerCase()}` : undefined;
}

function number(
  value: string | null,
  min: number,
  max: number,
  step: number,
): number | undefined {
  if (value === null || value === "" || !/^\d+(\.\d+)?$/.test(value)) {
    return undefined;
  }
  const n = Number(value);
  if (n < min || n > max) return undefined;
  return Number.isInteger(Math.round(((n - min) / step) * 1e6) / 1e6)
    ? n
    : undefined;
}

/** Параметры адреса с настройками. */
export const SETTING_KEYS = ["size", "color", "stroke", "rotate", "flip"];

/** Есть ли в адресе хоть одна настройка. */
export const hasSettings = (query: URLSearchParams): boolean =>
  SETTING_KEYS.some((key) => query.has(key));

/** Настройки из адреса страницы; неверное значение — по умолчанию. */
export function readSettings(query: URLSearchParams): IconSettings {
  const size = number(query.get("size"), SIZE_MIN, SIZE_MAX, 1);
  const color = parseColor(query.get("color"));
  const stroke = number(
    query.get("stroke"),
    STROKE_MIN,
    STROKE_MAX,
    STROKE_STEP,
  );
  const degrees = query.get("rotate");
  const rotate = ["0", "90", "180", "270"].indexOf(degrees ?? "") as number;
  const flip = (query.get("flip") ?? "").split(",");
  return {
    size: size ?? DEFAULT_SETTINGS.size,
    ...(color === undefined ? {} : { color }),
    ...(stroke === undefined ? {} : { stroke }),
    rotate: rotate > 0 ? (rotate as Quarter) : 0,
    hflip: flip.includes("horizontal"),
    vflip: flip.includes("vertical"),
  };
}

/** Параметры адреса для настроек: только отличные от умолчаний, в постоянном порядке. */
export function settingsParams(s: IconSettings): URLSearchParams {
  const out = new URLSearchParams();
  if (s.size !== DEFAULT_SETTINGS.size) out.set("size", String(s.size));
  if (s.color !== undefined) out.set("color", s.color.slice(1));
  if (s.stroke !== undefined) out.set("stroke", String(s.stroke));
  if (s.rotate !== 0) out.set("rotate", String(s.rotate * 90));
  const flip = [s.hflip ? "horizontal" : "", s.vflip ? "vertical" : ""].filter(
    (f) => f !== "",
  );
  if (flip.length > 0) out.set("flip", flip.join(","));
  return out;
}

/** Есть ли что сбросить. */
export const changed = (s: IconSettings): boolean =>
  settingsParams(s).toString() !== "";

/**
 * Пропсы Icon пакета по настройкам: размер — высотой, цвет — только монохромным, толщина — только где
 * она меняет рисунок (strokes, ADR-0041), поворот и отражение — атрибутами пакета (ADR-0031).
 */
export function iconProps(
  s: IconSettings,
  o: { size?: number; palette: boolean; strokes: boolean },
): {
  height: number;
  color?: string;
  strokeWidth?: number;
  rotate?: Quarter;
  flip?: "horizontal" | "vertical" | "horizontal,vertical";
} {
  const flip =
    s.hflip && s.vflip
      ? "horizontal,vertical"
      : s.hflip
        ? "horizontal"
        : s.vflip
          ? "vertical"
          : undefined;
  return {
    height: o.size ?? s.size,
    ...(s.color !== undefined && !o.palette ? { color: s.color } : {}),
    ...(s.stroke !== undefined && o.strokes ? { strokeWidth: s.stroke } : {}),
    ...(s.rotate !== 0 ? { rotate: s.rotate } : {}),
    ...(flip === undefined ? {} : { flip }),
  };
}

// Хранилище вкладки: панель и страница иконки видят одно и то же.
let current: IconSettings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

export const settingsStore = {
  get: (): IconSettings => current,
  set(next: IconSettings) {
    current = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Настройки вкладки: на сервере и при гидратации — по умолчанию. */
export function useIconSettings(): IconSettings {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.get,
    () => DEFAULT_SETTINGS,
  );
}
