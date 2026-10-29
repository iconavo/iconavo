// Общее для проверок в браузерах (песочница, пример на Next.js, сбои сети): вердикт строки отчёта,
// раскладка текста, сторожа консоли и нарушений CSP, снимки. Чистые части проверяются тестами без
// браузера.

import type { Page } from "playwright";

/** Итог проверки в браузере: true — да, false — нет, null — только сведения или не проверялось. */
export interface Verdict {
  ok: boolean | null;
  note: string;
}

export const pass = (note: string): Verdict => ({ ok: true, note });
export const fail = (note: string): Verdict => ({ ok: false, note });

/** Положение текста: левый верхний угол в CSS-пикселях. */
export interface Spot {
  left: number;
  top: number;
}

/** Текст не сдвинулся — с точностью до полпикселя. */
export function layoutVerdict(before: Spot[], after: Spot[]): Verdict {
  if (before.length === 0 || before.length !== after.length) {
    return { ok: false, note: "положение текста не измерено" };
  }
  const moved = before.filter((spot, i) => {
    const later = after[i] as Spot;
    return (
      Math.abs(spot.left - later.left) > 0.5 ||
      Math.abs(spot.top - later.top) > 0.5
    );
  }).length;
  return moved === 0
    ? { ok: true, note: `${before.length} имён на месте` }
    : { ok: false, note: `сдвинулось ${moved} из ${before.length} имён` };
}

/**
 * Записи браузера о запросе, который не удался, — не ошибки страницы: 404 иконок, которых нет, и
 * упавшие хосты в сценариях сбоев сети. Chrome и WebKit пишут «Failed to load resource», Firefox о
 * запросе к чужому адресу без ответа — «CORS request did not succeed». Настоящую ошибку CORS — ответ
 * без нужного заголовка — Firefox называет иначе, и она остаётся ошибкой.
 */
export const isRequestFailure = (text: string) =>
  text.startsWith("Failed to load resource") ||
  text.includes("(Reason: CORS request did not succeed)");

/** Что пишет страница: предупреждения и ошибки, кроме записей о неудавшихся запросах. */
export function watch(page: Page) {
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "warning") warnings.push(text);
    else if (message.type() === "error" && !isRequestFailure(text)) {
      errors.push(text);
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return { warnings, errors };
}

/** Нарушения CSP — слушатель до скриптов страницы. */
export async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const list: string[] = [];
    (window as unknown as { violations: string[] }).violations = list;
    document.addEventListener("securitypolicyviolation", (e) =>
      list.push(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber} ${e.sample}`.trim(),
      ),
    );
  });
}

export const violations = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { violations?: string[] }).violations ?? [],
  );

/**
 * Снимок страницы или её части. Для снимка Playwright вставляет в страницу свой стиль, и строгая
 * политика WebKit его отклоняет: нарушения и ошибки, пришедшие во время снимка, не в счёт.
 */
export async function shot(
  page: Page,
  seen: { errors: string[] },
  selector?: string,
): Promise<string> {
  const before = (await violations(page)).length;
  const errors = seen.errors.length;
  const png = await (selector ? page.locator(selector) : page).screenshot({
    caret: "initial",
  });
  await page.waitForTimeout(200);
  seen.errors.length = errors;
  await page.evaluate((n) => {
    const list = (window as unknown as { violations?: string[] }).violations;
    if (list) list.length = n;
  }, before);
  return png.toString("base64");
}
