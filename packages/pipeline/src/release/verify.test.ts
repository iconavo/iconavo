import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FetchFn } from "../sources/npm.js";
import { RELEASE_OUT_DIR, scriptUrl } from "./config.js";
import {
  type FakeVersion,
  fakeBuild,
  fakePack,
  fakeRegistry,
  packFiles,
  publishedAll,
  SCRIPT,
  writeReleaseRepo,
} from "./fixture.testing.js";
import { prepareRelease, readReleasePlan } from "./prepare.js";
import { releaseVerifyFailed, verifyRelease } from "./verify.js";

const COMMIT = "c".repeat(40);

/** План выпуска version: подготовка по реестру before. */
async function planOf(
  version: string,
  before: Parameters<typeof fakeRegistry>[0],
) {
  const root = await writeReleaseRepo({ version });
  const outDir = join(root, RELEASE_OUT_DIR);
  await prepareRelease({
    root,
    outDir,
    registry: fakeRegistry(before),
    first: true,
    commit: COMMIT,
    buildScript: fakeBuild,
    pack: fakePack(),
  });
  return { root, plan: await readReleasePlan(join(outDir, "plan.json")) };
}

/** jsDelivr: ответы по очереди, последний — дальше всегда. */
function jsdelivr(
  ...answers: (Response | (() => Response))[]
): FetchFn & { calls: number } {
  const fn = (async () => {
    fn.calls++;
    const a = answers[Math.min(fn.calls - 1, answers.length - 1)] as
      | Response
      | (() => Response);
    return typeof a === "function" ? a() : a.clone();
  }) as unknown as FetchFn & { calls: number };
  fn.calls = 0;
  return fn;
}

const script =
  (body: Buffer = SCRIPT, cors = true) =>
  () =>
    new Response(new Uint8Array(body), {
      status: 200,
      headers: cors ? { "access-control-allow-origin": "*" } : {},
    });

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

const after = (v: FakeVersion[]) => fakeRegistry(publishedAll(v));

describe("pnpm release verify", () => {
  it("первая публикация: архивы из плана, provenance из release.yml, токен у первой версии, jsDelivr", async () => {
    const { root, plan } = await planOf("0.1.0", {});
    const report = await verifyRelease({
      root,
      plan,
      registry: after([
        { version: "0.1.0", token: true, provenance: { commit: COMMIT } },
      ]),
      fetch: jsdelivr(script()),
      clean: false,
    });
    expect(releaseVerifyFailed(report)).toBe(false);
    expect(report.packages.map((p) => [p.name, p.status, p.publisher])).toEqual(
      [
        ["@iconavo-ui/core", "ok", "token"],
        ["@iconavo-ui/icon", "ok", "token"],
        ["@iconavo-ui/react", "ok", "token"],
      ],
    );
    expect(report.packages[0]?.notes[0]).toContain(
      "первая версия выложена временным токеном",
    );
    expect(report.jsdelivr).toMatchObject({
      status: "ok",
      url: scriptUrl("0.1.0"),
    });
    expect(report.clean.status).toBe("skipped");
  });

  it("не тот workflow, коммит и архив, токен у второй версии — проблемы", async () => {
    const { root, plan } = await planOf(
      "0.1.1",
      publishedAll([{ version: "0.1.0", token: true }]),
    );
    const report = await verifyRelease({
      root,
      plan,
      registry: after([
        { version: "0.1.0", token: true },
        {
          version: "0.1.1",
          token: true,
          files: {
            ...packFiles("core", "0.1.1"),
            "dist/index.js": Buffer.from("other"),
          },
          provenance: {
            workflow: ".github/workflows/publish.yml",
            commit: "d".repeat(40),
          },
        },
      ]),
      fetch: jsdelivr(script()),
      clean: false,
    });
    const core = report.packages[0];
    expect(core?.problems).toEqual([
      expect.stringContaining("архив в npm — не тот, что собрала «Подготовка»"),
      "provenance: workflow .github/workflows/publish.yml, а не .github/workflows/release.yml",
      `provenance: коммит ${"d".repeat(40)}, а запуск собирал ${COMMIT}`,
      "версия 0.1.1 выложена токеном, а не доверенной публикацией: проверьте на npmjs.com Trusted Publisher и Publishing access",
    ]);
    expect(releaseVerifyFailed(report)).toBe(true);
  });

  it("npm показывает версию не сразу — проверка ждёт до срока", async () => {
    const { root, plan } = await planOf("0.1.0", {});
    const { now, sleep } = clock();
    const registry = fakeRegistry(
      publishedAll([
        { version: "0.1.0", token: true, provenance: { commit: COMMIT } },
      ]),
      { hidden: 3 },
    );
    const report = await verifyRelease({
      root,
      plan,
      registry,
      waitMs: 300_000,
      fetch: jsdelivr(new Response("nope", { status: 404 }), script()),
      clean: false,
      now,
      sleep,
    });
    expect(releaseVerifyFailed(report)).toBe(false);
    expect(registry.calls.filter((c) => c.startsWith("packument")).length).toBe(
      6,
    );
  });

  it("срок вышел — версии нет; jsDelivr без файла, с другим файлом и без CORS — проблемы", async () => {
    const { root, plan } = await planOf("0.1.0", {});
    const { now, sleep } = clock();
    const none = await verifyRelease({
      root,
      plan,
      registry: fakeRegistry({}),
      waitMs: 60_000,
      fetch: jsdelivr(new Response("nope", { status: 404 })),
      clean: false,
      now,
      sleep,
    });
    expect(none.packages[0]?.problems[0]).toContain("0.1.0 нет в npm");
    expect(none.jsdelivr.problems).toEqual([
      expect.stringContaining("jsDelivr не отдаёт скрипт этой версии"),
    ]);
    const registry = after([
      { version: "0.1.0", token: true, provenance: { commit: COMMIT } },
    ]);
    const other = await verifyRelease({
      root,
      plan,
      registry,
      fetch: jsdelivr(script(Buffer.from("other"), false)),
      clean: false,
    });
    expect(other.jsdelivr.problems).toEqual([
      expect.stringContaining("jsDelivr отдаёт скрипт с хэшем"),
      "jsDelivr без Access-Control-Allow-Origin: * — модульный скрипт с другого сайта не загрузится",
    ]);
  });
});
