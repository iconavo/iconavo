// Проверка ответа Cloudflare Turnstile (шаг 3 фазы 5, ADR-0055): регистрация, восстановление и вход после
// трёх неудач. Ответ виджета — заголовок x-captcha-response; сервис спрашивает siteverify с секретом и
// адресом человека. Не ответил, ответил не так, страница не та — отказ: без проверки код не уходит.

export interface TurnstileCheck {
  token: string;
  ip: string | null;
  secret: string | undefined;
  /** Адрес siteverify; у превью и тестов — свой. */
  url: string;
  /** Страница, где решали задачу: iconavo.dev; у превью — 127.0.0.1. */
  hostname: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/** Длиннее у Turnstile не бывает. */
const MAX_TOKEN = 2048;
const TIMEOUT_MS = 5_000;

export async function verifyTurnstile(c: TurnstileCheck): Promise<boolean> {
  if (c.secret === undefined || c.secret === "") return false;
  if (c.token === "" || c.token.length > MAX_TOKEN) return false;
  const form = new FormData();
  form.set("secret", c.secret);
  form.set("response", c.token);
  if (c.ip !== null) form.set("remoteip", c.ip);
  try {
    const res = await c.fetch(c.url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      success?: unknown;
      hostname?: unknown;
    };
    return body.success === true && body.hostname === c.hostname;
  } catch {
    return false;
  }
}
