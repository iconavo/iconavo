// Сборка, превью и проверка сервиса аккаунтов (шаг 3 фазы 5): бандл собирается один раз, превью — ровно он
// в Node, проверка живого адреса гоняется против превью (без Google и перехода с http — их нет у
// 127.0.0.1).

import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountMetadata, buildAccount } from "./build.js";
import {
  accountCheckFailed,
  checkAccount,
  formatAccountCheck,
} from "./check.js";
import {
  type AccountPreview,
  PREVIEW_CAPTCHA,
  startAccountPreview,
} from "./preview.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SITE = "http://127.0.0.1:4284";

let dir: string;
let preview: AccountPreview;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "iconavo-account-"));
  preview = await startAccountPreview({
    root: ROOT,
    outDir: dir,
    port: 0,
    siteOrigin: SITE,
    samples: true,
  });
}, 120_000);

afterAll(async () => {
  await preview?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("сборка сервиса аккаунтов", () => {
  it("metadata: D1 по database_id, бакет фото в ЕС, письма только от support@, три лимита, закрытый режим, nodejs_compat", () => {
    const m = accountMetadata() as {
      compatibility_flags: string[];
      bindings: { type: string; name: string }[];
      limits: { cpu_ms: number };
      observability: { logs: { invocation_logs: boolean } };
    };
    expect(m.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(m.bindings).toContainEqual({
      type: "d1",
      name: "DB",
      database_id: "e8e0aa82-9874-4bd2-b2f0-b67672c4a95e",
    });
    // Фото — закрытый бакет со строгой привязкой к ЕС (PR 4а).
    expect(m.bindings).toContainEqual({
      type: "r2_bucket",
      name: "FILES",
      bucket_name: "iconavo-account-files",
      jurisdiction: "eu",
    });
    expect(m.bindings).toContainEqual({
      type: "send_email",
      name: "EMAIL",
      allowed_sender_addresses: ["support@iconavo.dev"],
    });
    expect(
      m.bindings.filter((b) => b.type === "ratelimit").map((b) => b.name),
    ).toEqual(["AUTH_LIMIT", "CODE_LIMIT", "CODE_IP_LIMIT"]);
    expect(m.bindings).toContainEqual({
      type: "plain_text",
      name: "ACCOUNT_ACCESS",
      text: "closed",
    });
    // Секретов в metadata нет: их вписывает выкладка.
    expect(m.bindings.some((b) => b.type === "secret_text")).toBe(false);
    expect(m.observability.logs.invocation_logs).toBe(false);
  });

  it("повтор без изменений не пишет ни байта и даёт ту же метку", async () => {
    const again = await buildAccount({ root: ROOT, outDir: dir });
    expect(again.written).toEqual([]);
    expect(again.build).toBe(preview.build);
    expect(again.build).toMatch(/^[0-9a-f]{8}$/);
  }, 120_000);
});

describe("превью сервиса аккаунтов", () => {
  it("четыре письма для примера: регистрация и восстановление на двух языках", () => {
    expect(
      preview.mail().map((m) => [m.to, m.subject.replace(/^\d{6}/, "КОД")]),
    ).toEqual([
      ["en@example.com", "КОД is your Iconavo sign-up code"],
      ["en@example.com", "КОД is your Iconavo password reset code"],
      ["ru@example.com", "КОД — код для регистрации в Iconavo"],
      ["ru@example.com", "КОД — код для нового пароля Iconavo"],
    ]);
  });

  it("страница писем и каждое письмо — с политикой без скриптов", async () => {
    const page = await fetch(`${preview.origin}/__preview/mail`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Писем: 4.");
    const one = await fetch(`${preview.origin}/__preview/mail/1.html`);
    expect(one.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
  });

  it("регистрация через HTTP: cookie сеанса доходит отдельной строкой Set-Cookie", async () => {
    const post = (path: string, body: unknown, cookie = "") =>
      fetch(`${preview.origin}${path}`, {
        method: "POST",
        headers: {
          origin: SITE,
          "content-type": "application/json",
          "x-captcha-response": PREVIEW_CAPTCHA,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      });
    const email = "http@example.com";
    expect((await post("/api/account/sign-up", { email })).status).toBe(200);
    const code = /\b\d{6}\b/.exec(preview.mail().at(-1)?.subject ?? "")?.[0];
    const signIn = await post("/api/auth/sign-in/email-otp", {
      email,
      otp: code,
    });
    expect(signIn.status).toBe(200);
    const cookies = signIn.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("iconavo.session_token="))).toBe(
      true,
    );
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    const session = await fetch(`${preview.origin}/api/auth/get-session`, {
      headers: { origin: SITE, cookie },
    });
    expect(
      ((await session.json()) as { user: { email: string } }).user.email,
    ).toBe(email);
  });

  it("Host — только 127.0.0.1 этого порта", async () => {
    // fetch заголовок Host не пускает — обычный запрос node:http.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      request(
        {
          host: "127.0.0.1",
          port: preview.port,
          path: "/",
          headers: { host: "evil.example" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
        .on("error", reject)
        .end();
    });
    expect(status).toBe(403);
  });
});

describe("проверка живого адреса — против превью", () => {
  it("все строки «да» (без Google и перехода с http)", async () => {
    const report = await checkAccount({
      base: preview.origin,
      site: SITE,
      expectBuild: preview.build,
      google: false,
      waitMs: 0,
    });
    expect(
      report.probes.filter((p) => p.problems.length > 0),
      formatAccountCheck(report).join("\n"),
    ).toEqual([]);
    expect(accountCheckFailed(report)).toBe(false);
    expect(report.probes.map((p) => p.name)).toEqual([
      "страница для людей",
      "robots.txt",
      "CORS — сайту",
      "CORS — чужой странице нет",
      "сеанс без cookie",
      "кабинет без входа",
      "фото без входа",
      "обратная связь без входа",
      "регистрация без Turnstile",
      "восстановление без Turnstile",
      "вход с чужой страницы",
      "регистрация паролем без кода закрыта",
    ]);
  });

  it("чужая сборка — строка «нет»", async () => {
    const report = await checkAccount({
      base: preview.origin,
      site: SITE,
      expectBuild: "00000000",
      google: false,
      waitMs: 0,
    });
    expect(report.probes[0]?.problems).toEqual([
      `отвечает сборка ${preview.build} вместо 00000000`,
    ]);
    expect(formatAccountCheck(report).at(-1)).toBe("Итог: есть проблемы (1).");
  });
});
