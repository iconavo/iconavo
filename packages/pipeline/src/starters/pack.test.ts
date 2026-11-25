import { describe, expect, it } from "vitest";
import type { PackageId } from "./config.js";
import {
  commandLine,
  type Pack,
  packVerdict,
  type RunError,
  run,
} from "./pack.js";

const pack = (
  id: PackageId,
  files: string[],
  extra: Partial<Pack> = {},
): Pack => ({
  id,
  name: `@iconavo-ui/${id}`,
  version: "0.1.0",
  file: `/tmp/iconavo-ui-${id}-0.1.0.tgz`,
  bytes: 1000,
  sha256: "0".repeat(64),
  files,
  manifest: {
    name: `@iconavo-ui/${id}`,
    dependencies: { "@iconavo-ui/core": "0.1.0" },
  },
  ...extra,
});

const good = () => [
  pack("core", ["LICENSE", "dist/index.d.ts", "dist/index.js", "package.json"]),
  pack("icon", [
    "LICENSE",
    "README.md",
    "dist/iconavo-icon.js",
    "dist/index.js",
    "package.json",
  ]),
  pack("react", ["LICENSE", "README.md", "dist/index.js", "package.json"]),
];

describe("состав архивов пакетов", () => {
  it("только package.json, README, LICENSE и dist/ — да", () => {
    expect(packVerdict(good()).ok).toBe(true);
  });

  it("исходники, тесты и tsconfig — нет", () => {
    const packs = good();
    (packs[0] as Pack).files.push(
      "src/index.ts",
      "dist/load.test.js",
      "tsconfig.json",
    );
    const v = packVerdict(packs);
    expect(v.ok).toBe(false);
    expect(v.note).toContain("src/index.ts");
    expect(v.note).toContain("dist/load.test.js");
    expect(v.note).toContain("tsconfig.json");
  });

  it("без dist/ и без скрипта тега — нет", () => {
    const packs = good();
    (packs[1] as Pack).files = ["package.json", "dist/index.js"];
    (packs[2] as Pack).files = ["package.json"];
    const v = packVerdict(packs);
    expect(v.note).toContain("dist/iconavo-icon.js");
    expect(v.note).toContain("@iconavo-ui/react: нет сборки dist/");
  });

  it("workspace: в package.json архива и разные версии — нет", () => {
    const packs = good();
    (packs[2] as Pack).manifest = {
      dependencies: { "@iconavo-ui/core": "workspace:*" },
    };
    (packs[1] as Pack).version = "0.1.1";
    const v = packVerdict(packs);
    expect(v.note).toContain("workspace:");
    expect(v.note).toContain("разные версии");
  });
});

describe("запуск команды (ревизия фазы 5, А-32, И-10)", () => {
  const node = (code: string) => run(process.execPath, ["-e", code], ".");

  it("возвращает только stdout: предупреждения из stderr не портят JSON", async () => {
    const out = await node(
      "console.log(JSON.stringify({a:1}));console.error('WARN x')",
    );
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it("длинный вывод — целиком: конец по close, а не по exit", async () => {
    const out = await node("process.stdout.write('x'.repeat(3000000))");
    expect(out.length).toBe(3_000_000);
  });

  it("код не 0 — ошибка с хвостом stderr, в output — только stdout", async () => {
    const error = (await node(
      "console.log('{}');console.error('npm error boom');process.exit(1)",
    ).catch((e: unknown) => e)) as RunError;
    expect(error.message).toContain("npm error boom");
    expect(error.output.trim()).toBe("{}");
  });
});

describe("строка команды", () => {
  it("cmd.exe: путь с & и скобками — в кавычках, кавычка внутри удваивается (ревизия фазы 5, И-20)", () => {
    const line = commandLine(
      "pnpm",
      ["pack", "--pack-destination", "C:\\R&D (копия)\\out", 'a"b', "--json"],
      "win32",
    );
    expect(line.args.at(-1)).toBe(
      '"pnpm pack --pack-destination "C:\\R&D (копия)\\out" "a""b" --json"',
    );
  });

  it("на Windows — через cmd.exe, аргумент с пробелом в кавычках", () => {
    const line = commandLine("npm", ["install", "a b"]);
    if (process.platform === "win32") {
      expect(line.args.at(-1)).toBe('"npm install "a b""');
      expect(line.verbatim).toBe(true);
    } else {
      expect(line).toEqual({
        file: "npm",
        args: ["install", "a b"],
        verbatim: false,
      });
    }
  });
});
