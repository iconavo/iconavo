// Адрес edge API для данных каталога (ADR-0024): свой — из NEXT_PUBLIC_ICONAVO_API (его задаёт только
// pnpm site --check: превью API этой ветки), иначе api.iconavo.dev. Тот же адрес берут сборка сайта и
// браузер: сетка набора догружает список имён сама. Next.js вписывает process.env.NEXT_PUBLIC_… в сборку;
// в Storybook (Vite) process может не быть.

function env(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export const API =
  env(() => process.env.NEXT_PUBLIC_ICONAVO_API) || "https://api.iconavo.dev";

/** Пауза перед повтором сорвавшегося запроса к edge API, мс. */
export const RETRY_DELAY_MS = 300;

/**
 * Запрос к edge API с одним повтором (18 ноября 2026): сбой сети или ответ 5xx — пауза и ещё одна
 * попытка. Тогда редкий сбой Cloudflare, R2 или сети не ломает сборку страницы — без повтора она
 * отвечала 500 (17 ноября 2026: /ru/ph/house-bold). Ответ 4xx — как есть: повтор его не изменит.
 * Отменённый запрос не повторяется. Второй сбой — тот же ответ или та же ошибка, решает вызывающий.
 */
export async function fetchApi(
  url: string,
  init?: RequestInit,
  fetchFn: typeof fetch = fetch,
  delayMs: number = RETRY_DELAY_MS,
): Promise<Response> {
  try {
    const response = await fetchFn(url, init);
    if (response.status < 500) return response;
    await response.body?.cancel().catch(() => {});
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
  }
  await new Promise((done) => setTimeout(done, delayMs));
  return fetchFn(url, init);
}
