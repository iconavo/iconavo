import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installVerdict,
  type LsNode,
  ourCopies,
  rewriteManifest,
} from "./install.js";
import type { Pack } from "./pack.js";

const packs = ["core", "icon", "react"].map(
  (id) =>
    ({
      id,
      name: `@iconavo-ui/${id}`,
      version: "0.0.0",
      file: join("/work", "packages", `iconavo-ui-${id}-0.0.0.tgz`),
    }) as Pack,
);

describe("package.json рабочей копии", () => {
  it("наши пакеты — архивы, ядро — прямой зависимостью", () => {
    const manifest = rewriteManifest(
      { dependencies: { "@iconavo-ui/react": "0.1.0", react: "19.3.1" } },
      packs,
      join("/work", "local", "react"),
    );
    expect(manifest.dependencies).toEqual({
      "@iconavo-ui/react": "file:../../packages/iconavo-ui-react-0.0.0.tgz",
      "@iconavo-ui/core": "file:../../packages/iconavo-ui-core-0.0.0.tgz",
      react: "19.3.1",
    });
  });

  it("без наших пакетов — как есть; пакет без архива — ошибка", () => {
    const plain = { dependencies: { react: "19.3.1" } };
    expect(rewriteManifest(plain, packs, "/x")).toBe(plain);
    expect(() =>
      rewriteManifest(
        { dependencies: { "@iconavo-ui/vue": "0.1.0" } },
        packs,
        "/x",
      ),
    ).toThrow("@iconavo-ui/vue");
  });
});

/** Дерево npm ls: ядро наверху и ссылка на него внутри React — без resolved. */
const tree = (
  core = "file:/work/packages/iconavo-ui-core-0.0.0.tgz",
): LsNode => ({
  dependencies: {
    "@iconavo-ui/core": { version: "0.0.0", resolved: core },
    "@iconavo-ui/react": {
      version: "0.0.0",
      resolved: "file:/work/packages/iconavo-ui-react-0.0.0.tgz",
      dependencies: { "@iconavo-ui/core": { version: "0.0.0" } },
    },
    react: {
      version: "19.3.1",
      resolved: "https://registry.npmjs.org/react/-/react-19.3.1.tgz",
    },
  },
});

const expected = (name: string) => ({
  name,
  version: "0.0.0",
  resolved: (r: string) => r.includes(`${name.slice(12)}-0.0.0.tgz`),
});

describe("установка", () => {
  it("ссылка на поставленную копию — не вторая копия", () => {
    expect(ourCopies(tree())).toHaveLength(3);
    const v = installVerdict(tree(), [
      expected("@iconavo-ui/react"),
      expected("@iconavo-ui/core"),
    ]);
    expect(v.ok).toBe(true);
    expect(v.note).toContain("@iconavo-ui/core@0.0.0");
  });

  it("ядро из реестра вместо архива — нет", () => {
    const v = installVerdict(tree("https://registry.npmjs.org/x.tgz"), [
      expected("@iconavo-ui/react"),
      expected("@iconavo-ui/core"),
    ]);
    expect(v.ok).toBe(false);
    expect(v.note).toContain("поставлен не оттуда");
  });

  it("две версии, лишний пакет и не поставленный — нет", () => {
    const t = tree();
    const react = t.dependencies?.["@iconavo-ui/react"] as LsNode;
    react.dependencies = {
      "@iconavo-ui/core": { version: "0.0.1", resolved: "file:/x.tgz" },
      "@iconavo-ui/icon": { version: "0.0.0", resolved: "file:/y.tgz" },
    };
    const v = installVerdict(t, [
      expected("@iconavo-ui/react"),
      expected("@iconavo-ui/core"),
      expected("@iconavo-ui/search"),
    ]);
    expect(v.note).toContain("несколько копий");
    expect(v.note).toContain("@iconavo-ui/icon: лишний пакет");
    expect(v.note).toContain("@iconavo-ui/search: не поставлен");
  });
});
