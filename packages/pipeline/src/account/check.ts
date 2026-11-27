// Проверка живого сервиса аккаунтов (шаг 3 фазы 5, ADR-0055) — pnpm account check: только открытые адреса,
// без ключей и без писем. Страница и её метка сборки (ждёт до 3 минут новую сборку), robots.txt, CORS
// только для iconavo.dev, сеанс без cookie, отказы без Turnstile и с чужой страницы, закрытые адреса Better
// Auth, вход через Google (ключи на месте и база пишет), переход с http. Каждое «да» — ответ живого
// адреса, а не наш вывод.

import { mismatch } from "../cdn/check.js";
import { retryable, retryDelay } from "../embed/client.js";
import { ACCOUNT_ORIGIN } from "./config.js";

export const CHECK_SITE = "https://iconavo.dev";
const FOREIGN = "https://example.com";

export interface AccountProbe {
  name: string;
  status?: number;
  problems: string[];
}

export interface AccountCheckReport {
  base: string;
  build?: string;
  expectBuild?: string;
  probes: AccountProbe[];
}

export interface AccountCheckOptions {
  base?: string;
  site?: string;
  expectBuild?: string;
  /** Google: у превью ключей нет — строку пропустить. */
  google?: boolean;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  waitMs?: number;
  log?: (line: string) => void;
}

const SECURITY: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

/** Запрос с повторами на сбой сети и временные ответы — как у других проверок. */
async function call(
  o: Required<Pick<AccountCheckOptions, "fetch" | "sleep">>,
  url: string,
  init: RequestInit,
): Promise<Response | string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await o.fetch(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (!retryable(res.status) || attempt >= 3) return res;
      await o.sleep(retryDelay(res.headers.get("retry-after"), attempt));
    } catch (e) {
      if (attempt >= 3) return `сбой сети: ${(e as Error).message}`;
      await o.sleep(retryDelay(null, attempt));
    }
  }
}

const codeOf = async (res: Response): Promise<unknown> => {
  try {
    return ((await res.clone().json()) as { code?: unknown } | null)?.code;
  } catch {
    return undefined;
  }
};

export async function checkAccount(
  o: AccountCheckOptions = {},
): Promise<AccountCheckReport> {
  const base = o.base ?? ACCOUNT_ORIGIN;
  const site = o.site ?? CHECK_SITE;
  const deps = {
    fetch:
      o.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init)),
    sleep:
      o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  };
  const now = o.now ?? Date.now;
  const report: AccountCheckReport = {
    base,
    probes: [],
    ...(o.expectBuild === undefined ? {} : { expectBuild: o.expectBuild }),
  };
  const probe = async (
    name: string,
    path: string,
    init: RequestInit,
    verify: (res: Response, p: AccountProbe) => Promise<void> | void,
  ) => {
    const p: AccountProbe = { name, problems: [] };
    report.probes.push(p);
    const res = await call(deps, `${base}${path}`, init);
    if (typeof res === "string") {
      p.problems.push(res);
      return;
    }
    p.status = res.status;
    await verify(res, p);
    o.log?.(
      `${name}: ${p.problems.length === 0 ? "ок" : p.problems.join("; ")}`,
    );
  };
  const expect = (
    p: AccountProbe,
    res: Response,
    status: number,
    code?: string,
  ) =>
    (async () => {
      if (res.status !== status) {
        p.problems.push(`ответ ${res.status} вместо ${status}`);
        return false;
      }
      if (code !== undefined) {
        const got = await codeOf(res);
        if (got !== code) p.problems.push(`код ${String(got)} вместо ${code}`);
      }
      return true;
    })();
  const headers = (
    p: AccountProbe,
    res: Response,
    wanted: Record<string, string>,
  ) => {
    for (const [name, value] of Object.entries(wanted)) {
      const problem = mismatch(res.headers, name, value);
      if (problem !== undefined) p.problems.push(problem);
    }
  };
  const json = { "content-type": "application/json" };

  // Страница и метка сборки: после выкладки новая сборка отвечает не сразу — ждём до 3 минут.
  await probe("страница для людей", "/", {}, async (res, p) => {
    let current = res;
    const deadline = now() + (o.waitMs ?? 180_000);
    while (
      o.expectBuild !== undefined &&
      current.headers.get("x-iconavo-build") !== o.expectBuild &&
      now() < deadline
    ) {
      await deps.sleep(10_000);
      const again = await call(deps, `${base}/`, {});
      if (typeof again === "string") break;
      current = again;
    }
    report.build = current.headers.get("x-iconavo-build") ?? undefined;
    if (await expect(p, current, 200)) {
      headers(p, current, { ...SECURITY, "x-robots-tag": "noindex, nofollow" });
      if (o.expectBuild !== undefined && report.build !== o.expectBuild) {
        p.problems.push(
          `отвечает сборка ${report.build ?? "без метки"} вместо ${o.expectBuild}`,
        );
      }
    }
  });
  await probe("robots.txt", "/robots.txt", {}, async (res, p) => {
    if (
      (await expect(p, res, 200)) &&
      (await res.text()) !== "User-agent: *\nDisallow: /\n"
    ) {
      p.problems.push("robots.txt не закрывает всё");
    }
  });
  await probe(
    "CORS — сайту",
    "/api/auth/get-session",
    {
      method: "OPTIONS",
      headers: { origin: site, "access-control-request-method": "POST" },
    },
    async (res, p) => {
      if (await expect(p, res, 204)) {
        headers(p, res, {
          "access-control-allow-origin": site,
          "access-control-allow-credentials": "true",
        });
      }
    },
  );
  await probe(
    "CORS — чужой странице нет",
    "/api/auth/get-session",
    {
      method: "OPTIONS",
      headers: { origin: FOREIGN, "access-control-request-method": "POST" },
    },
    async (res, p) => {
      await expect(p, res, 403, "FORBIDDEN_ORIGIN");
      if (res.headers.get("access-control-allow-origin") !== null) {
        p.problems.push("чужой странице отвечает CORS");
      }
    },
  );
  await probe(
    "сеанс без cookie",
    "/api/auth/get-session",
    { headers: { origin: site } },
    async (res, p) => {
      if (await expect(p, res, 200)) {
        if ((await res.text()) !== "null")
          p.problems.push("без cookie есть сеанс");
        headers(p, res, {
          ...SECURITY,
          "cache-control": "no-store",
          "access-control-allow-origin": site,
          "access-control-allow-credentials": "true",
        });
      }
    },
  );
  // Своя почта на каждый запуск: лимит писем на одну почту — раз в минуту.
  const email = `check-${now().toString(36)}@example.com`;
  await probe(
    "регистрация без Turnstile",
    "/api/account/sign-up",
    {
      method: "POST",
      headers: { ...json, origin: site },
      body: JSON.stringify({ email }),
    },
    async (res, p) => {
      if (await expect(p, res, 403, "CAPTCHA_REQUIRED")) {
        headers(p, res, {
          "x-iconavo-captcha": "required",
          "access-control-allow-origin": site,
        });
      }
    },
  );
  await probe(
    "восстановление без Turnstile",
    "/api/auth/email-otp/request-password-reset",
    {
      method: "POST",
      headers: { ...json, origin: site },
      body: JSON.stringify({ email }),
    },
    async (res, p) => {
      await expect(p, res, 403, "CAPTCHA_REQUIRED");
    },
  );
  await probe(
    "вход с чужой страницы",
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { ...json, origin: FOREIGN },
      body: JSON.stringify({ email, password: "check-password-1" }),
    },
    async (res, p) => {
      await expect(p, res, 403, "FORBIDDEN_ORIGIN");
    },
  );
  await probe(
    "регистрация паролем без кода закрыта",
    "/api/auth/sign-up/email",
    { method: "POST", headers: { ...json, origin: site }, body: "{}" },
    async (res, p) => {
      await expect(p, res, 404, "NOT_FOUND");
    },
  );
  if (o.google !== false) {
    await probe(
      "вход через Google",
      "/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { ...json, origin: site },
        body: JSON.stringify({ provider: "google", callbackURL: `${site}/` }),
      },
      async (res, p) => {
        if (!(await expect(p, res, 200))) {
          if ((await codeOf(res)) === "PROVIDER_NOT_FOUND") {
            p.problems.push(
              "у сервиса нет ключей Google: секреты окружения account",
            );
          }
          return;
        }
        const answer = (await res.json()) as { url?: unknown };
        const url = new URL(String(answer.url ?? "about:blank"));
        if (url.origin !== "https://accounts.google.com") {
          p.problems.push(`ведёт не в Google: ${url.origin}`);
        }
        if ((url.searchParams.get("client_id") ?? "") === "") {
          p.problems.push("нет client_id");
        }
        const back = `${base}/api/auth/callback/google`;
        if (url.searchParams.get("redirect_uri") !== back) {
          p.problems.push(
            `возврат ${url.searchParams.get("redirect_uri")} вместо ${back}`,
          );
        }
      },
    );
  }
  if (base.startsWith("https://")) {
    const p: AccountProbe = { name: "переход с http", problems: [] };
    report.probes.push(p);
    const res = await call(deps, `${base.replace("https://", "http://")}/`, {});
    if (typeof res === "string") {
      p.problems.push(res);
    } else {
      p.status = res.status;
      if (
        ![301, 308].includes(res.status) ||
        res.headers.get("location") !== `${base}/`
      ) {
        p.problems.push(
          `ответ ${res.status} → ${res.headers.get("location") ?? "без адреса"} вместо перехода на ${base}/`,
        );
      }
    }
  }
  return report;
}

export const accountCheckFailed = (r: AccountCheckReport): boolean =>
  r.probes.some((p) => p.problems.length > 0);

/** Таблица для терминала и сводки CI (Markdown). */
export function formatAccountCheck(r: AccountCheckReport): string[] {
  const lines = [
    `Сервис аккаунтов ${r.base}: сборка ${r.build ?? "нет"}${r.expectBuild === undefined ? "" : `, ждали ${r.expectBuild}`}`,
    "",
    "| Проверка | Ответ | Итог |",
    "|---|---|---|",
    ...r.probes.map(
      (p) =>
        `| ${p.name} | ${p.status ?? "—"} | ${p.problems.length === 0 ? "да" : `нет: ${p.problems.join("; ")}`} |`,
    ),
    "",
    accountCheckFailed(r)
      ? `Итог: есть проблемы (${r.probes.filter((p) => p.problems.length > 0).length}).`
      : "Итог: ок.",
  ];
  return lines;
}
