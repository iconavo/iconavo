// Браузеры для песочницы (фаза 3, шаг 5; ADR-0035): Playwright запускает установленный Google Chrome, а
// Firefox и WebKit — свои сборки, их ставит pnpm exec playwright install webkit firefox (около 190 МБ,
// в %LOCALAPPDATA%\ms-playwright). WebKit на Windows — движок Safari, но не сам Safari: по
// документации Playwright отличаются видео, графика и сеть. playwright грузится только здесь.

import type { Browser } from "playwright";

export type BrowserName = "chrome" | "firefox" | "webkit";

/** Браузеры проверки по порядку: Chrome, Firefox и WebKit вместо Safari. */
export const BROWSERS: readonly BrowserName[] = ["chrome", "firefox", "webkit"];

export const BROWSER_TITLES: Record<BrowserName, string> = {
  chrome: "Chrome",
  firefox: "Firefox",
  webkit: "WebKit (Safari)",
};

export const isBrowserName = (value: string): value is BrowserName =>
  (BROWSERS as readonly string[]).includes(value);

/** Запустить браузер; не запустился — ошибка с подсказкой, что поставить. */
export async function launchBrowser(
  name: BrowserName,
  headless: boolean,
): Promise<Browser> {
  const playwright = await import("playwright");
  try {
    return name === "chrome"
      ? await playwright.chromium.launch({ channel: "chrome", headless })
      : await playwright[name].launch({ headless });
  } catch (e) {
    const hint =
      name === "chrome"
        ? "нужен установленный Google Chrome"
        : `поставьте браузеры: pnpm exec playwright install webkit firefox`;
    throw new Error(
      `${BROWSER_TITLES[name]} не запустился — ${hint}. ${(e as Error).message.split("\n")[0]}`,
    );
  }
}
