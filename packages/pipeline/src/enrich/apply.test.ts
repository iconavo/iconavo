import { type SearchFile, validate } from "@iconavo-ui/schema";
import { describe, expect, it } from "vitest";
import {
  applyEnrichment,
  carryEnrichment,
  type Enrichment,
  enrichmentBases,
  isEnriched,
} from "./apply.js";

const lang = (p: string) => ({
  description: `${p} description`,
  synonyms: [`${p}1`, `${p}2`, `${p}3`, `${p}4`, `${p}5`],
});
const value = (p: string, promptVersion = 1): Enrichment => ({
  ru: lang(`${p}-ru`),
  en: lang(`${p}-en`),
  promptVersion,
});
/** Отпечаток по схеме — 12 символов 0-9 и a-f: ключ дополняется нулями. */
const entry = (key: string) => ({
  fingerprint: key.padEnd(12, "0"),
  tags: ["t"],
});
const file = (icons: SearchFile["icons"], prefix = "demo"): SearchFile => ({
  prefix,
  icons,
});
const TABLER = ["", "-filled"];

describe("базовые иконки", () => {
  it("суффикс снимается, только если основа сама есть в наборе", () => {
    const s = file({
      heart: entry("a"),
      "heart-filled": entry("b"),
      "star-filled": entry("c"),
      "done-outline-filled": entry("d"),
      "done-outline": entry("e"),
    });
    expect(enrichmentBases(s, TABLER)).toEqual([
      "done-outline",
      "heart",
      "star-filled",
    ]);
  });

  it("без суффиксов все иконки базовые, по алфавиту", () => {
    expect(enrichmentBases(file({ b: entry("1"), a: entry("2") }), [])).toEqual(
      ["a", "b"],
    );
  });
});

describe("применение", () => {
  it("описания — только у имён из файла, остальное без изменений; файл проходит схему", () => {
    const s = file({ heart: entry("a"), "heart-filled": entry("b") });
    const out = applyEnrichment(
      s,
      new Map([
        ["heart", value("h")],
        ["ghost", value("g")],
      ]),
    );
    expect(out.icons.heart).toEqual({ ...entry("a"), ...value("h") });
    expect(out.icons["heart-filled"]).toEqual(entry("b"));
    expect(isEnriched(out.icons.heart)).toBe(true);
    expect(isEnriched(out.icons["heart-filled"])).toBe(false);
    expect(isEnriched(undefined)).toBe(false);
    expect(validate("search", out)).toEqual([]);
    // Исходный файл не тронут.
    expect(s.icons.heart).toEqual(entry("a"));
  });

  it("запись без версии промпта переносится без неё", () => {
    const out = applyEnrichment(
      file({ a: entry("1") }),
      new Map([["a", { ru: lang("r"), en: lang("e") }]]),
    );
    expect(out.icons.a).not.toHaveProperty("promptVersion");
    expect(validate("search", out)).toEqual([]);
  });
});

describe("перенос описаний с диска", () => {
  const fresh = file({
    heart: entry("a"),
    "heart-filled": entry("b"),
    star: entry("c2"),
    house: entry("d"),
  });
  const previous = file({
    heart: { ...entry("a"), ...value("h") },
    "heart-filled": { ...entry("b"), ...value("v") },
    star: { ...entry("c1"), ...value("s") },
    home: { ...entry("d"), ...value("home") },
    gone: { ...entry("e"), ...value("z") },
  });

  it("тот же отпечаток переходит; другой отпечаток, вариант и пропавшее имя отбрасываются; переименование — по карте", () => {
    const r = carryEnrichment(
      fresh,
      previous,
      new Map([["home", "house"]]),
      TABLER,
    );
    expect(r.stop).toEqual([]);
    expect(r.kept).toEqual(["heart", "house"]);
    expect(r.dropped).toEqual(["gone", "heart-filled", "star"]);
    expect(r.search.icons.house).toEqual({ ...entry("d"), ...value("home") });
    expect(r.search.icons.heart).toEqual({ ...entry("a"), ...value("h") });
    expect(r.search.icons["heart-filled"]).toEqual(entry("b"));
    expect(r.search.icons.star).toEqual(entry("c2"));
    expect(validate("search", r.search)).toEqual([]);
  });

  it("файла на диске нет — свежий файл без изменений", () => {
    expect(carryEnrichment(fresh, undefined, new Map(), TABLER)).toEqual({
      search: fresh,
      kept: [],
      dropped: [],
      stop: [],
    });
  });

  it("файл не по схеме или от другого набора — «СТОП»", () => {
    const broken = carryEnrichment(
      fresh,
      { prefix: "demo", icons: { a: { tagz: [] } } },
      new Map(),
      TABLER,
    );
    expect(broken.stop[0]).toMatch(/не проходит схему/);
    const foreign = carryEnrichment(
      fresh,
      file({}, "other"),
      new Map(),
      TABLER,
    );
    expect(foreign.stop[0]).toMatch(/от набора «other»/);
  });

  it("неподвижная точка: перенос результата применения ничего не меняет", () => {
    const applied = applyEnrichment(
      fresh,
      new Map([
        ["heart", value("h")],
        ["star", value("s")],
      ]),
    );
    const again = carryEnrichment(fresh, applied, new Map(), TABLER);
    expect(again.search).toEqual(applied);
    expect(again.dropped).toEqual([]);
    expect(again.kept).toEqual(["heart", "star"]);
  });
});
