// Обрезка фото профиля (кадр B2 «Crop your photo», шаг 3 фазы 5, PR 4): картинку двигают мышью или
// стрелками и приближают ползунком, а круг 200 px посередине — то, что останется. Всё считается здесь, без
// DOM: окно (components/account/PhotoDialog.tsx) только рисует и отправляет квадрат 512 × 512 JPEG — сервис
// принимает квадрат PNG или JPEG от 128 до 1024 px.

export const CROP = {
  /** Круг — диаметр, CSS px. */
  ring: 200,
  /** Сторона готового фото. */
  out: 512,
  minZoom: 1,
  maxZoom: 4,
  /** Шаг стрелок, CSS px. */
  step: 10,
  /** Меньше — «файл не подходит» (подсказка макета: «at least 200 × 200 px»). */
  minSide: 200,
  /** Больше — тоже не подходит: телефонные снимки до 15 МБ проходят. */
  maxBytes: 15 * 1024 * 1024,
} as const;

/** Положение: масштаб и сдвиг центра картинки от центра круга, CSS px. */
export interface CropState {
  zoom: number;
  x: number;
  y: number;
}

/** Масштаб «1»: короткая сторона картинки — ровно диаметр круга. */
export const baseScale = (width: number, height: number): number =>
  CROP.ring / Math.min(width, height);

/** Сдвиг и масштаб в пределах: круг всегда закрыт картинкой. */
export function clampCrop(
  state: CropState,
  width: number,
  height: number,
): CropState {
  const zoom = Math.min(CROP.maxZoom, Math.max(CROP.minZoom, state.zoom));
  const scale = baseScale(width, height) * zoom;
  const maxX = Math.max(0, (width * scale - CROP.ring) / 2);
  const maxY = Math.max(0, (height * scale - CROP.ring) / 2);
  // «+ 0» — без минус нуля: -0 и 0 — одно и то же положение.
  return {
    zoom,
    x: Math.min(maxX, Math.max(-maxX, state.x)) + 0,
    y: Math.min(maxY, Math.max(-maxY, state.y)) + 0,
  };
}

/** Где рисовать картинку в области w × h (CSS px). */
export function imageRect(
  state: CropState,
  width: number,
  height: number,
  areaWidth: number,
  areaHeight: number,
): { left: number; top: number; width: number; height: number } {
  const scale = baseScale(width, height) * state.zoom;
  return {
    left: areaWidth / 2 + state.x - (width * scale) / 2,
    top: areaHeight / 2 + state.y - (height * scale) / 2,
    width: width * scale,
    height: height * scale,
  };
}

/** Квадрат под кругом — в пикселях картинки. */
export function sourceSquare(
  state: CropState,
  width: number,
  height: number,
): { x: number; y: number; size: number } {
  const scale = baseScale(width, height) * state.zoom;
  const size = CROP.ring / scale;
  return {
    x: width / 2 - state.x / scale - size / 2,
    y: height / 2 - state.y / scale - size / 2,
    size,
  };
}

/** Файл подходит ли: PNG или JPEG, не больше 15 МБ, не меньше 200 × 200 px. */
export function photoFileProblem(
  file: { type: string; size: number },
  width?: number,
  height?: number,
): "file" | undefined {
  if (file.type !== "image/png" && file.type !== "image/jpeg") return "file";
  if (file.size > CROP.maxBytes) return "file";
  if (
    width !== undefined &&
    height !== undefined &&
    Math.min(width, height) < CROP.minSide
  ) {
    return "file";
  }
  return undefined;
}

/**
 * «Изменён 3 месяца назад»: сегодня, дни, месяцы, годы — словами языка страницы (Intl.RelativeTimeFormat).
 * Дата не читается — пусто.
 */
export function changedAgo(
  iso: string | null,
  now: number,
  lang: string,
): string {
  if (iso === null) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const days = Math.floor(Math.max(0, now - then) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (days < 30) return rtf.format(-days, "day");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}
