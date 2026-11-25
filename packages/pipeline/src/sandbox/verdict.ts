// Общее для проверок в браузерах (песочница, пример на Next.js, сбои сети): вердикт строки отчёта,
// раскладка текста, сторожа консоли и нарушений CSP, снимки. Чистые части проверяются тестами без
// браузера.

import type { Frame, Page } from "playwright";

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
 * без нужного заголовка — Firefox называет иначе, и она остаётся ошибкой. WebKit запрос Next.js к самому
 * сайту (`?_rsc=`: предзагрузка ссылки), оборванный уходом со страницы, называет «… due to access control
 * checks.»; у запросов к хостам иконок `_rsc` не бывает, и там эта запись остаётся ошибкой.
 */
export const isRequestFailure = (text: string) =>
  text.startsWith("Failed to load resource") ||
  text.includes("(Reason: CORS request did not succeed)") ||
  isAbortedPrefetch(text) ||
  isAbortedStatic(text);

/**
 * WebKit: запрос ядра к статике превью (`/_static/`), который отменило само ядро — пачка API успела, и
 * запасные запросы отменяются (ADR-0030), — или уход со страницы. WebKit пишет его «due to access control
 * checks», хотя CORS у превью есть; настоящий отказ CORS он сообщает ещё и строкой «… is not allowed by
 * Access-Control-Allow-Origin» — её проверки видят (ревизия фазы 5, PR 4: рюкзак из 500 иконок).
 */
export const isAbortedStatic = (text: string) =>
  /\/_static\/\S* due to access control checks\.$/.test(text);

/**
 * WebKit: запрос Next.js к самому сайту (`?_rsc=`), оборванный уходом со страницы. Приходит и записью
 * консоли, и необработанной ошибкой страницы с тем же текстом — не ошибка страницы ни там, ни там.
 */
export const isAbortedPrefetch = (text: string) =>
  /[?&]_rsc=\S* due to access control checks\.$/.test(text);

/**
 * Firefox: подгрузка скрипта Next.js с самого сайта (`/_next/static/`), оборванная перезагрузкой или
 * уходом со страницы, — предупреждение «Loading failed for the <script> …». Так 17 ноября 2026 дважды
 * падала проверка кнопки темы, которая перезагружает главную. Это не ошибка страницы: скрипт, который
 * по-настоящему не загрузился, ломает гидратацию, и её ловят остальные строки проверки. Скрипты
 * не из `/_next/static/` — тег иконок, пример с хэшем — по-прежнему проблема.
 */
export const isAbortedScript = (text: string) =>
  /Loading failed for the <script> with source “[^”]*\/_next\/static\//.test(
    text,
  );

/** Что пишет страница: предупреждения и ошибки, кроме записей о неудавшихся запросах. */
export function watch(page: Page) {
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "warning") {
      if (!isAbortedScript(text)) warnings.push(text);
    } else if (message.type() === "error" && !isRequestFailure(text)) {
      errors.push(text);
    }
  });
  // Отменённые запросы WebKit сообщает и ошибкой страницы с тем же текстом (isAbortedPrefetch, isAbortedStatic).
  page.on("pageerror", (error) => {
    if (!isAbortedPrefetch(error.message) && !isAbortedStatic(error.message)) {
      errors.push(error.message);
    }
  });
  return { warnings, errors };
}

/**
 * Нарушения CSP всех документов страницы: слушатель recordViolations передаёт каждое сюда, и переход
 * или перезагрузка их не стирают (ревизия фазы 5, И-6).
 */
const pageViolations = new WeakMap<Page, string[]>();

/** Нарушения CSP — слушатель до скриптов страницы; второй вызов для той же страницы ничего не делает. */
export async function recordViolations(page: Page): Promise<void> {
  if (pageViolations.has(page)) return;
  const all: string[] = [];
  pageViolations.set(page, all);
  await page.exposeBinding("iconavoViolation", (_source, text: string) => {
    all.push(text);
  });
  await page.addInitScript(() => {
    const list: string[] = [];
    const w = window as unknown as {
      violations: string[];
      iconavoViolation?: (text: string) => unknown;
    };
    w.violations = list;
    document.addEventListener("securitypolicyviolation", (e) => {
      const text =
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber} ${e.sample}`.trim();
      list.push(text);
      void w.iconavoViolation?.(text);
    });
  });
}

/** Нарушения CSP текущего документа страницы или рамки внутри неё: слушатель — в каждой рамке. */
export const violations = (page: Page | Frame) =>
  page.evaluate(
    () => (window as unknown as { violations?: string[] }).violations ?? [],
  );

/**
 * Нарушения CSP всех документов страницы с recordViolations: сценарий из нескольких переходов видит
 * и те, что были до последнего. Сначала — пустой вызов в страницу: сообщения о нарушениях, отправленные
 * раньше, доходят до него. Без recordViolations — нарушения текущего документа.
 */
export async function allViolations(page: Page): Promise<string[]> {
  const all = pageViolations.get(page);
  if (all === undefined) return violations(page);
  await page.evaluate(() => 0).catch(() => {});
  return [...all];
}

/** Шаг проверки с названием: ошибка говорит, на каком шаге она остановилась. */
export async function step<T>(
  title: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw new Error(`${title}: ${(e as Error).message.split("\n")[0]}`);
  }
}

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
  const all = pageViolations.get(page);
  const kept = all?.length ?? 0;
  const errors = seen.errors.length;
  const png = await (selector ? page.locator(selector) : page).screenshot({
    caret: "initial",
  });
  await page.waitForTimeout(200);
  seen.errors.length = errors;
  // Этот вызов в страницу — заодно последний: сообщения о нарушениях времени снимка дошли до него.
  await page.evaluate((n) => {
    const list = (window as unknown as { violations?: string[] }).violations;
    if (list) list.length = n;
  }, before);
  if (all !== undefined) all.length = kept;
  return png.toString("base64");
}
