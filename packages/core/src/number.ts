// Числа для атрибутов SVG — копия cleanNumber и formatNumber конвейера
// (packages/pipeline/src/normalize/canvas.ts). Копия намеренная: файлы статики неизменяемы
// (ADR-0022), и правка ядра не должна менять их байты. Что SVG ядра без настроек совпадает со
// статикой, проверяет тест конвейера на всех иконках data/.

/** Число без «шума» плавающей точки (0.1 + 0.2 → 0.3) и без минус нуля. */
export function cleanNumber(n: number): number {
  const clean = Number(n.toPrecision(12));
  return Object.is(clean, -0) ? 0 : clean;
}

/**
 * Число для атрибута: без шума и без экспоненты у малых чисел (1e-7 → 0.0000001). У огромных, от 1e21,
 * экспонента остаётся: toFixed её не раскрывает, а обрезка нулей откусила бы ноль показателя — 1e30 → 1e+3
 * (ревизия фазы 5, П-4).
 */
export function formatNumber(n: number): string {
  const clean = cleanNumber(n);
  const text = String(clean);
  if (!/e-/.test(text)) return text;
  const fixed = clean.toFixed(20).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}
