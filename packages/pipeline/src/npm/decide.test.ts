import { describe, expect, it } from "vitest";
import {
  compareNames,
  everPublished,
  type FirstLookInput,
  firstLook,
  firstPublished,
  nextVersion,
} from "./decide.js";
import type { NpmVersionDoc, Packument } from "./registry.js";

const doc = (
  version: string,
  extra: Partial<NpmVersionDoc> = {},
): NpmVersionDoc => ({
  version,
  tarball: `https://registry.npmjs.org/demo/-/demo-${version}.tgz`,
  integrity: "sha512-AAAA",
  fingerprint: "f-old",
  setVersion: "aaaaaaaa",
  ...extra,
});

function packument(
  docs: NpmVersionDoc[],
  tags: Record<string, string>,
  unpublished: string[] = [],
): Packument {
  const times = new Map<string, string>();
  docs.forEach((d, i) => {
    times.set(
      d.version,
      `2026-10-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
    );
  });
  for (const u of unpublished) times.set(u, "2026-10-30T00:00:00Z");
  return {
    name: "@iconavo-ui/icons-demo",
    distTags: tags,
    versions: new Map(docs.map((d) => [d.version, d])),
    times,
  };
}

const input = (extra: Partial<FirstLookInput>): FirstLookInput => ({
  packument: undefined,
  fingerprint: "f-new",
  tag: "next",
  allowNew: false,
  force: false,
  firstVersion: "1.0.0",
  formatMajor: 1,
  releases: ["bbbbbbbb", "aaaaaaaa"],
  ...extra,
});

describe("firstLook", () => {
  it("пакета нет: с «первой публикацией» — 1.0.0, без неё — ждёт", () => {
    expect(firstLook(input({ allowNew: true }))).toEqual({
      kind: "decided",
      action: "new",
      version: "1.0.0",
    });
    expect(firstLook(input({}))).toEqual({
      kind: "decided",
      action: "awaiting",
      version: "1.0.0",
    });
  });

  it("тот же отпечаток — без изменений; с --force — патч от старшей версии", () => {
    const p = packument([doc("1.0.0", { fingerprint: "f-new" })], {
      next: "1.0.0",
    });
    expect(firstLook(input({ packument: p }))).toEqual({
      kind: "decided",
      action: "unchanged",
      version: "1.0.0",
      base: "1.0.0",
    });
    expect(firstLook(input({ packument: p, force: true }))).toEqual({
      kind: "decided",
      action: "patch",
      version: "1.0.1",
      base: "1.0.0",
    });
  });

  it("другой отпечаток — сравнить имена с версией под тегом", () => {
    const p = packument([doc("1.0.0"), doc("1.1.0")], { next: "1.1.0" });
    const look = firstLook(input({ packument: p }));
    expect(look).toMatchObject({
      kind: "compare",
      base: { version: "1.1.0" },
      highest: "1.1.0",
    });
  });

  it("номер — от самой старшей версии, даже снятой", () => {
    const p = packument(
      [doc("1.0.0", { fingerprint: "f-new" })],
      { next: "1.0.0" },
      ["1.0.1"],
    );
    expect(firstLook(input({ packument: p, force: true }))).toMatchObject({
      action: "patch",
      version: "1.0.2",
    });
    expect(everPublished(p)).toEqual(["1.0.0", "1.0.1"]);
  });

  it("1.10.0 старше 1.9.0; предварительные версии не считаются", () => {
    const p = packument(
      [
        doc("1.9.0"),
        doc("1.10.0", { fingerprint: "f-new" }),
        doc("2.0.0-beta.1"),
      ],
      { next: "1.10.0" },
    );
    expect(everPublished(p)).toEqual(["1.9.0", "1.10.0"]);
    expect(firstLook(input({ packument: p, force: true }))).toMatchObject({
      version: "1.10.1",
    });
  });

  it("тега нет — сравнение со старшей живой версией", () => {
    const p = packument(
      [doc("1.0.0"), doc("1.2.0", { fingerprint: "f-new" })],
      {
        latest: "1.0.0",
      },
    );
    expect(firstLook(input({ packument: p }))).toMatchObject({
      action: "unchanged",
      version: "1.2.0",
    });
  });

  it("версия без отметки iconavo — «СТОП»: её выложил не конвейер", () => {
    const p = packument([doc("1.0.0", { fingerprint: undefined })], {
      next: "1.0.0",
    });
    expect(firstLook(input({ packument: p }))).toMatchObject({
      kind: "stop",
      message: expect.stringContaining("без отметки iconavo"),
    });
  });

  it("в npm версия набора, которой нет в журнале, — «СТОП»: данные в npm новее", () => {
    const p = packument([doc("1.0.0", { setVersion: "cccccccc" })], {
      next: "1.0.0",
    });
    expect(firstLook(input({ packument: p }))).toMatchObject({
      kind: "stop",
      message: expect.stringContaining("в npm данные новее"),
    });
  });

  it("в npm формат новее конвейера — «СТОП»", () => {
    const p = packument([doc("2.0.0")], { next: "2.0.0" });
    expect(firstLook(input({ packument: p }))).toMatchObject({
      kind: "stop",
      message: expect.stringContaining("формат пакета в конвейере — 1"),
    });
  });

  it("пакет без версий вида 1.2.3 — «СТОП»", () => {
    const p = packument([doc("0.0.0-x")], { next: "0.0.0-x" });
    expect(firstLook(input({ packument: p }))).toMatchObject({ kind: "stop" });
  });
});

describe("compareNames", () => {
  const base = doc("1.2.3");
  const names = (...list: string[]) => new Set(list);

  it("новые имена — средняя цифра, без новых — последняя", () => {
    expect(
      compareNames({
        base,
        highest: "1.2.3",
        publishedNames: names("a", "b"),
        names: names("a", "b", "c"),
        formatMajor: 1,
      }),
    ).toEqual({
      kind: "decided",
      action: "minor",
      version: "1.3.0",
      added: ["c"],
    });
    expect(
      compareNames({
        base,
        highest: "1.2.3",
        publishedNames: names("a", "b"),
        names: names("b", "a"),
        formatMajor: 1,
      }),
    ).toEqual({
      kind: "decided",
      action: "patch",
      version: "1.2.4",
      added: [],
    });
  });

  it("пропало имя — «СТОП» (ADR-0005)", () => {
    expect(
      compareNames({
        base,
        highest: "1.2.3",
        publishedNames: names("a", "b", "gone"),
        names: names("a", "b"),
        formatMajor: 1,
      }),
    ).toMatchObject({
      kind: "stop",
      message: expect.stringContaining("пропали имена (1): gone"),
    });
  });

  it("новый формат — первая цифра", () => {
    expect(
      compareNames({
        base,
        highest: "1.2.3",
        publishedNames: names("a"),
        names: names("a", "b"),
        formatMajor: 2,
      }),
    ).toMatchObject({ action: "major", version: "2.0.0" });
  });
});

describe("nextVersion и firstPublished", () => {
  it("номера", () => {
    expect(nextVersion("1.2.3", "patch", 1)).toEqual({
      version: "1.2.4",
      action: "patch",
    });
    expect(nextVersion("1.2.3", "minor", 1)).toEqual({
      version: "1.3.0",
      action: "minor",
    });
    expect(nextVersion("1.2.3", "patch", 2)).toEqual({
      version: "2.0.0",
      action: "major",
    });
  });

  it("первая версия — самая ранняя по времени выхода", () => {
    const p = packument([doc("1.0.0"), doc("1.0.1")], { next: "1.0.1" });
    expect(firstPublished(p)).toBe("1.0.0");
  });
});
