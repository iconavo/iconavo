// Turnstile Cloudflare на сайте (шаг 3 фазы 5, PR 3; ADR-0055): регистрация, новый пароль и вход после трёх
// неудач. Скрипт грузится только в этот момент, а не с каждой страницей: гость, который не входит, к
// Cloudflare не обращается. Виджет — по вызову (render=explicit), «только если нужно действие человека»
// (appearance: interaction-only): обычно его не видно вовсе, задача решается сама. Один ответ — один
// запрос, после него виджет убирается. CSP пускает скрипт и рамку виджета (lib/headers.ts); у проверки
// сайта скрипт подставной — из превью сервиса аккаунтов.

import { TURNSTILE_SITE_KEY } from "./account-config";
import type { Lang } from "./i18n";

interface TurnstileApi {
  render(container: HTMLElement, params: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;

/** Скрипт Turnstile — один раз на страницу; не загрузился — следующий вызов попробует снова. */
export function loadTurnstile(src: string): Promise<TurnstileApi> {
  if (window.turnstile !== undefined) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      loading = undefined;
      script.remove();
      reject(new Error("turnstile: скрипт не загрузился"));
    };
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (window.turnstile !== undefined) resolve(window.turnstile);
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

export interface CaptchaOptions {
  src: string;
  lang: Lang;
  dark: boolean;
}

/**
 * Ответ виджета в контейнере окна. Ошибка виджета или конец срока — отказ: человек нажмёт кнопку ещё
 * раз, и виджет нарисуется заново.
 */
export async function captchaToken(
  container: HTMLElement,
  o: CaptchaOptions,
): Promise<string> {
  const api = await loadTurnstile(o.src);
  return new Promise<string>((resolve, reject) => {
    let id: string | undefined;
    // Убрать виджет — после его же обратного вызова, не внутри него.
    const finish = (settle: () => void) => {
      setTimeout(() => {
        if (id !== undefined) {
          try {
            api.remove(id);
          } catch {
            // Уже убран.
          }
        }
      }, 0);
      settle();
    };
    const fail = () =>
      finish(() => reject(new Error("turnstile: задача не решена")));
    id = api.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: o.dark ? "dark" : "light",
      language: o.lang,
      size: "flexible",
      appearance: "interaction-only",
      "response-field": false,
      "refresh-expired": "never",
      callback: (token: string) => finish(() => resolve(token)),
      "error-callback": () => {
        fail();
        return true;
      },
      "expired-callback": fail,
      "timeout-callback": fail,
    });
  });
}
