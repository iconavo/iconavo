// Числа для атрибутов SVG — копия cleanNumber и formatNumber конвейера
// (packages/pipeline/src/normalize/canvas.ts). Копия намеренная: файлы статики неизменяемы
// (ADR-0022), и правка ядра не должна менять их байты. Что SVG ядра без настроек совпадает со
// статикой, проверяет тест конвейера на всех иконках data/.

/** Число без «шума» плавающей точки (0.1 + 0.2 → 0.3) и без минус нуля. */
export function cleanNumber(n: number): number {
  const clean = Number(n.toPrecision(12));
  return Object.is(clean, -0) ? 0 : clean;
}

/** Число для атрибута: без шума и без экспоненты (1e-7 → 0.0000001). */
export function formatNumber(n: number): string {
  const clean = cleanNumber(n);
  const text = String(clean);
  return /e/i.test(text) ? clean.toFixed(20).replace(/\.?0+$/, "") : text;
}
