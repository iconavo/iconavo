import { describe, expect, it } from "vitest";
import {
  downVerdict,
  fallbackVerdict,
  isBatch,
  type NetOutcome,
  netHosts,
  silentVerdict,
  slowVerdict,
} from "./net-check.js";
import { NET_NAMES } from "./net-page.js";

const h = netHosts("http://127.0.0.1:5000", "http://127.0.0.1:6000");
const BATCH = `${h.api}/lucide.json?icons=bell,heart`;
const file = (host: string, name: string) =>
  `${host}/v/c3b3f7a7/lucide/${name}.json`;
const ABSENT = NET_NAMES.at(-1) as string;

/** Все иконки нарисованы, у нарочно отсутствующей — рамка. */
const drawn = NET_NAMES.map((icon) => ({
  icon,
  drawn: icon !== ABSENT,
  missing: icon === ABSENT,
}));

const outcome = (over: Partial<NetOutcome>): NetOutcome => ({
  requests: [],
  icons: drawn,
  warnings: [],
  errors: [],
  before: [{ left: 10, top: 10 }],
  after: [{ left: 10, top: 10 }],
  ...over,
});

describe("сбои сети: разбор", () => {
  it("пачка — у хоста API, кроме его статики", () => {
    expect(isBatch(BATCH, h)).toBe(true);
    expect(isBatch(`${h.cdn}/manifest.json`, h)).toBe(false);
    expect(isBatch(`${h.cdn2}/manifest.json`, h)).toBe(false);
  });

  it("API отказал: иконки с первого хоста статики, со второго — ни одной", () => {
    const requests = [
      { url: BATCH, at: 0 },
      { url: `${h.cdn}/manifest.json`, at: 5 },
      { url: file(h.cdn, "bell"), at: 9 },
    ];
    const ok = fallbackVerdict(
      outcome({ requests }),
      h,
      h.cdn,
      "с первого",
      h.cdn2,
    );
    expect(ok.ok).toBe(true);
    expect(ok.note).toContain(
      "иконки нарисованы с первого хоста статики (файлов: 1)",
    );
    const both = fallbackVerdict(
      outcome({
        requests: [...requests, { url: file(h.cdn2, "bell"), at: 9 }],
      }),
      h,
      h.cdn,
      "с первого",
      h.cdn2,
    );
    expect(both.ok).toBe(false);
    expect(both.note).toContain("файлы и с другого хоста статики: 1");
    const none = fallbackVerdict(outcome({}), h, h.cdn2, "со второго");
    expect(none.note).toContain("пачка к API не уходила");
    expect(none.note).toContain("ни одного файла со второго хоста статики");
  });

  it("не нарисованная иконка, нет рамки у отсутствующей и ошибка страницы — проблемы", () => {
    const icons = drawn.map((i) =>
      i.icon === "lucide:bell"
        ? { ...i, drawn: false }
        : i.icon === ABSENT
          ? { ...i, missing: false }
          : i,
    );
    const v = fallbackVerdict(
      outcome({
        icons,
        errors: ["TypeError: boom"],
        requests: [
          { url: BATCH, at: 0 },
          { url: file(h.cdn, "x"), at: 1 },
        ],
      }),
      h,
      h.cdn,
      "с первого",
    );
    expect(v.ok).toBe(false);
    expect(v.note).toContain(
      `нарисовано ${NET_NAMES.length - 2} из ${NET_NAMES.length - 1}`,
    );
    expect(v.note).toContain(`у ${ABSENT} нет рамки`);
    expect(v.note).toContain("ошибка: TypeError: boom");
  });

  it("API молчит: статика — через порог 1,5 с после пачки, не раньше и не намного позже", () => {
    const at = (gap: number) =>
      outcome({
        requests: [
          { url: BATCH, at: 100 },
          { url: `${h.cdn}/manifest.json`, at: 100 + gap },
          { url: file(h.cdn, "bell"), at: 110 + gap },
        ],
      });
    expect(silentVerdict(at(1520), h).ok).toBe(true);
    expect(silentVerdict(at(1520), h).note).toContain("статика через 1520 мс");
    expect(silentVerdict(at(800), h).note).toContain("раньше порога 1500 мс");
    expect(silentVerdict(at(4000), h).note).toContain("намного позже");
    expect(
      silentVerdict(outcome({ requests: [{ url: BATCH, at: 0 }] }), h).note,
    ).toBe("к статике не перешли");
  });

  it("медленная сеть: заглушки, иконки и текст на месте", () => {
    expect(slowVerdict(outcome({}), 9).ok).toBe(true);
    expect(slowVerdict(outcome({}), 0).note).toContain("заглушек не было");
    const moved = slowVerdict(outcome({ after: [{ left: 10, top: 14 }] }), 9);
    expect(moved.ok).toBe(false);
    expect(moved.note).toContain("сдвинулось 1 из 1 имён");
  });

  it("ничего не отвечает: пачка в 0, 1, 3 и 7 с, рамка у всех, по предупреждению на имя", () => {
    const failed = NET_NAMES.map(
      (name) => `Iconavo: icon "${name}" failed to load TypeError`,
    );
    const all = NET_NAMES.map((icon) => ({
      icon,
      drawn: false,
      missing: true,
    }));
    const requests = [20, 1030, 3040, 7060].map((at) => ({ url: BATCH, at }));
    const ok = downVerdict(
      outcome({ requests, icons: all, warnings: failed }),
      h,
    );
    expect(ok.ok).toBe(true);
    const early = downVerdict(
      outcome({
        requests: [0, 300, 900, 2000].map((at) => ({ url: BATCH, at })),
        icons: all,
        warnings: [...failed, failed[0] as string],
      }),
      h,
    );
    expect(early.ok).toBe(false);
    expect(early.note).toContain("пачки в 0,0 с, 0,3 с, 0,9 с, 2,0 с");
    expect(early.note).toContain("ждали по одному");
    expect(
      downVerdict(outcome({ requests, warnings: failed }), h).note,
    ).toContain(`рамка у 1 из ${NET_NAMES.length}`);
  });
});
