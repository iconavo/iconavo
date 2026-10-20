import { describe, expect, it } from "vitest";
import { SVG_NS } from "../svg/xml.js";
import { type Baseline, baselineFromTexts } from "./baseline.js";
import { checkSet, type QcInput, share } from "./run.js";

const SQUARE = `<path fill="currentColor" d="M4 4h16v16H4z"/>`;
const CIRCLE = `<circle cx="12" cy="12" r="8" fill="currentColor"/>`;
const svg = (body: string) =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24">${body}</svg>`;
/** Иконка набора; исходник по умолчанию — то же тело в своём <svg>. */
const item = (name: string, body: string, source = svg(body)) => ({
  name,
  icon: { body, width: 24, height: 24 },
  source,
});
const input = (
  icons: QcInput["icons"],
  extra: Partial<QcInput> = {},
): QcInput => ({
  palette: "monochrome",
  grid: 24,
  icons,
  aliases: [],
  compareOriginals: true,
  ...extra,
});
const baseline = (
  icons: Record<string, string>,
  sourceChanged = false,
): Baseline => ({
  label: "коммит ccccccc, demo-icons@1.0.0",
  sourceChanged,
  icons: new Map(
    Object.entries(icons).map(([name, body]) => [
      name,
      { body, width: 24, height: 24 },
    ]),
  ),
});
const kinds = (qc: Awaited<ReturnType<typeof checkSet>>) =>
  qc.findings.map((f) => [f.kind, f.name]);

describe("контроль набора", () => {
  it("пустая — «СТОП»; почти пустая и обрезанная — только находки, с картинкой и рамкой холста", async () => {
    const qc = await checkSet(
      input([
        item("dot", `<circle cx="12" cy="12" r=".75" fill="currentColor"/>`),
        item("edge", `<circle cx="22" cy="12" r="6" fill="currentColor"/>`),
        item("empty", `<circle cx="12" cy="12" r=".1" fill="currentColor"/>`),
        item("square", SQUARE),
      ]),
    );
    expect(qc.checked).toBe(4);
    expect(kinds(qc)).toEqual([
      ["empty", "empty"],
      ["sparse", "dot"],
      ["cropped", "edge"],
    ]);
    expect(qc.stop).toEqual([
      "пустые иконки: 1 — закрашено меньше 0,05% холста",
    ]);
    const cropped = qc.findings[2];
    expect(cropped?.text).toMatch(/^выходит за холст на \d/);
    expect(cropped?.images[0]).toMatchObject({
      label: "resvg",
      width: 96,
      height: 96,
      frame: { x: 16, y: 16, width: 64, height: 64 },
    });
    expect(cropped?.images[0]?.src).toMatch(/^data:image\/png;base64,/);
  });

  it("вылет дальше запаса — «и больше»: за запасом рисунок не виден", async () => {
    const qc = await checkSet(
      input([item("far", `<path fill="currentColor" d="M4 4h40v16H4z"/>`)]),
    );
    expect(kinds(qc)).toEqual([["cropped", "far"]]);
    expect(qc.findings[0]?.text).toBe(
      "выходит за холст на 25% и больше (16 px из 64)",
    );
  });

  it("иконку, которую resvg не нарисовал, проверить нельзя — «СТОП»", async () => {
    const qc = await checkSet(input([item("bad", "<path", svg(SQUARE))]));
    expect(kinds(qc)).toEqual([["failed", "bad"]]);
    expect(qc.checked).toBe(0);
    expect(qc.stop[0]).toMatch(/^resvg не нарисовал иконок: 1/);
  });

  it("отличие от оригинала: белая деталь стала цветом текста", async () => {
    const original = svg(
      `<path d="M4 4h16v16H4z"/><path fill="#fff" d="M8 8h8v8H8z"/>`,
    );
    const qc = await checkSet(
      input([
        item(
          "framed",
          `<path fill="currentColor" d="M4 4h16v16H4z"/><path fill="currentColor" d="M8 8h8v8H8z"/>`,
          original,
        ),
      ]),
    );
    expect(kinds(qc)).toEqual([["original", "framed"]]);
    expect(qc.findings[0]?.images.map((i) => i.label)).toEqual([
      "оригинал",
      "стало",
      "наложение",
    ]);
    expect(qc.stop).toEqual([]);
  });

  it("тёмно-серый оригинал совпадает с результатом монохромного набора, а в цветном цвет важен", async () => {
    const gray = svg(`<path fill="#212121" d="M4 4h16v16H4z"/>`);
    expect(
      (await checkSet(input([item("gray", SQUARE, gray)]))).findings,
    ).toEqual([]);
    const blue = svg(`<path fill="#00f" d="M4 4h16v16H4z"/>`);
    const color = await checkSet(
      input([item("red", `<path fill="#f00" d="M4 4h16v16H4z"/>`, blue)], {
        palette: "color",
      }),
    );
    expect(kinds(color)).toEqual([["original", "red"]]);
  });

  it("исходник, который не рисуется, — пометка в отчёте, не «СТОП»; без сравнения с оригиналом его нет", async () => {
    const qc = await checkSet(input([item("a", SQUARE, "<svg")]));
    expect(qc.findings[0]?.text).toMatch(/^оригинал не нарисовался/);
    expect(qc.stop).toEqual([]);
    const skipped = await checkSet(
      input([item("a", SQUARE, "<svg")], { compareOriginals: false }),
    );
    expect(skipped.findings).toEqual([]);
  });

  it("сдвиг на сотую долю единицы — не изменение", async () => {
    const qc = await checkSet(
      input(
        [item("a", `<path fill="currentColor" d="M4.01 4h16v16H4.01z"/>`)],
        {
          baseline: baseline({ a: SQUARE }),
        },
      ),
    );
    expect([qc.changed, qc.stop]).toEqual([0, []]);
  });

  it("прошлая версия: изменилось и пропало больше 2% при том же источнике — «СТОП»", async () => {
    const qc = await checkSet(
      input([item("a", SQUARE), item("b", SQUARE), item("c", CIRCLE)], {
        baseline: baseline({ a: SQUARE, b: SQUARE, c: SQUARE, gone: SQUARE }),
      }),
    );
    expect(qc.baseline).toEqual({
      label: "коммит ccccccc, demo-icons@1.0.0",
      sourceChanged: false,
      names: 4,
    });
    expect([qc.changed, qc.missing, qc.added]).toEqual([1, ["gone"], []]);
    expect(qc.changedShare).toBe(0.5);
    expect(qc.stop.join("\n")).toMatch(
      /источник тот же, а изменилось или пропало 50% имён \(изменились 1, нет в источнике 1\).*--accept-changes\. Сравнение идёт с версией в main/,
    );
    const changed = qc.findings.find((f) => f.kind === "changed");
    expect(changed?.name).toBe("c");
    expect(changed?.text).toMatch(/^отличается \d/);
    expect(changed?.images.map((i) => i.label)).toEqual([
      "было",
      "стало",
      "наложение",
    ]);
  });

  it("с --accept-changes или при новой версии источника изменения не останавливают набор", async () => {
    const icons = [item("a", CIRCLE)];
    const accepted = await checkSet(
      input(icons, { baseline: baseline({ a: SQUARE }), acceptChanges: true }),
    );
    expect([accepted.stop, accepted.accepted, accepted.changed]).toEqual([
      [],
      true,
      1,
    ]);
    const updated = await checkSet(
      input(icons, { baseline: baseline({ a: SQUARE }, true) }),
    );
    expect([updated.stop, updated.accepted, updated.changed]).toEqual([
      [],
      false,
      1,
    ]);
  });

  it("пустую иконку --accept-changes не пропускает", async () => {
    const qc = await checkSet(
      input(
        [item("empty", `<circle cx="12" cy="12" r=".1" fill="currentColor"/>`)],
        {
          acceptChanges: true,
        },
      ),
    );
    expect(qc.stop).toHaveLength(1);
  });

  it("та же прошлая версия — ноль изменений; новые имена — для сведения", async () => {
    const qc = await checkSet(
      input([item("a", SQUARE), item("new", CIRCLE)], {
        baseline: baseline({ a: SQUARE }),
      }),
    );
    expect([qc.changed, qc.changedShare, qc.added, qc.stop]).toEqual([
      0,
      0,
      ["new"],
      [],
    ]);
  });

  it("алиас меняется вместе с родителем: считается, но карточка одна; размер — тоже изменение", async () => {
    const qc = await checkSet(
      input([item("a", CIRCLE)], {
        aliases: [["a-outline", "a"]],
        baseline: baseline({ a: SQUARE, "a-outline": SQUARE }),
      }),
    );
    expect(qc.changed).toBe(2);
    expect(kinds(qc)).toEqual([["changed", "a"]]);
    const resized = await checkSet(
      input(
        [
          {
            ...item("a", SQUARE),
            icon: { body: SQUARE, width: 24, height: 25 },
          },
        ],
        {
          baseline: baseline({ a: SQUARE }),
        },
      ),
    );
    expect(resized.findings.find((f) => f.kind === "changed")?.text).toBe(
      "размер был 24×24, стал 24×25",
    );
  });

  it("скрытые иконки и алиасы прошлой версии правило 2% не трогают; пропавшая видимая — считается", async () => {
    const file = (extra: Record<string, { body: string }> = {}) =>
      JSON.stringify({
        prefix: "demo",
        width: 24,
        height: 24,
        icons: {
          a: { body: SQUARE },
          h1: { body: CIRCLE, hidden: true },
          h2: { body: CIRCLE, hidden: true },
          ...extra,
        },
        aliases: { old: { parent: "a" } },
      });
    const past = (icons: string) =>
      baselineFromTexts({
        label: "коммит ccccccc, demo-icons@1.0.0",
        sourceChanged: false,
        icons,
      });
    const quiet = await checkSet(
      input([item("a", SQUARE)], { baseline: past(file()) }),
    );
    expect([quiet.changed, quiet.missing, quiet.added]).toEqual([0, [], []]);
    expect(quiet.baseline?.names).toBe(2);
    expect(quiet.stop).toEqual([]);
    const lost = await checkSet(
      input([item("a", SQUARE)], {
        baseline: past(file({ b: { body: CIRCLE } })),
      }),
    );
    expect(lost.missing).toEqual(["b"]);
    expect(lost.changedShare).toBeCloseTo(1 / 3);
    expect(lost.stop.join("\n")).toMatch(/изменилось или пропало 33,3% имён/);
  });

  it("без прошлой версии — причина вместо сравнения", async () => {
    const qc = await checkSet(
      input([item("a", SQUARE)], {
        baselineNote: "data/demo/icons.json ещё нет в истории git",
      }),
    );
    expect(qc.baseline).toBeUndefined();
    expect(qc.baselineNote).toBe("data/demo/icons.json ещё нет в истории git");
    expect([qc.changed, qc.added, qc.missing]).toEqual([0, [], []]);
  });

  it("доли в процентах без лишних нулей", () => {
    expect([0, 0.0003, 0.005, 0.0049, 0.02, 0.042, 0.5, 1].map(share)).toEqual([
      "0%",
      "0,03%",
      "0,5%",
      "0,49%",
      "2%",
      "4,2%",
      "50%",
      "100%",
    ]);
  });
});
