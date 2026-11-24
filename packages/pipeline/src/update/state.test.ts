import { describe, expect, it } from "vitest";
import {
  type Facts,
  factsSchema,
  hasMarker,
  isBot,
  type PrFact,
  robotState,
} from "./state.js";

const REPO = "iconavo/iconavo";
const BRANCH = "auto/ph";
const MARKER = "iconavo-bot:ph@2.1.1";
const COMMENT = `<!-- ${MARKER} -->`;
const BOT = "iconavo-bot[bot]";
const OWNER = "kyanakhmetov-cpu";
const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

const pr = (p: Partial<PrFact> & Pick<PrFact, "number">): PrFact => ({
  state: "open",
  merged: false,
  markers: [COMMENT],
  headRepo: REPO,
  headSha: SHA,
  ...p,
});
const closed = (p: Partial<PrFact> & Pick<PrFact, "number">): PrFact =>
  pr({ state: "closed", ...p });
const facts = (p: Partial<Facts> = {}): Facts => ({
  repo: REPO,
  changed: true,
  prs: [],
  closedBy: {},
  branch: null,
  ...p,
});
const state = (p: Partial<Facts> = {}) => robotState(facts(p), MARKER, BRANCH);
const botTip = { sha: SHA, author: BOT };
const humanTip = { sha: SHA, author: "Konstantin" };

describe("что робот делает с PR набора", () => {
  it("новая версия, ни PR, ни ветки — собрать", () => {
    expect(state()).toEqual({ action: "build" });
  });

  it("PR из чужой копии с той же веткой — не наш, сколько бы их ни было", () => {
    const forks = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0
        ? pr({ number: 300 + i, headRepo: "someone/iconavo" })
        : closed({ number: 300 + i, headRepo: "someone/iconavo" }),
    );
    const closedBy = Object.fromEntries(
      forks.map((p) => [String(p.number), "someone"]),
    );
    expect(state({ prs: forks, closedBy })).toEqual({ action: "build" });
    // Свой открытый PR находится и среди чужих; репозиторий ветки удалён — тоже не наш.
    expect(
      state({
        prs: [...forks, pr({ number: 7 }), pr({ number: 8, headRepo: null })],
        closedBy,
        branch: botTip,
      }),
    ).toEqual({ action: "build", open: 7 });
  });

  it("открытый PR: последний коммит робота — собрать заново, человека — не трогать", () => {
    expect(state({ prs: [pr({ number: 7 })], branch: botTip })).toEqual({
      action: "build",
      open: 7,
    });
    expect(state({ prs: [pr({ number: 7 })], branch: humanTip })).toEqual({
      action: "hands-off",
      open: 7,
    });
  });

  it("PR этой версии закрыл человек — версия отклонена; закрыл робот или слили — нет", () => {
    const prs = [closed({ number: 5 })];
    expect(state({ prs, closedBy: { "5": OWNER } })).toEqual({
      action: "rejected",
      rejected: 5,
    });
    // Кто закрыл, неизвестно, — считается отказом: решение владельца важнее.
    expect(state({ prs, closedBy: { "5": null } })).toEqual({
      action: "rejected",
      rejected: 5,
    });
    expect(state({ prs })).toEqual({ action: "rejected", rejected: 5 });
    expect(state({ prs, closedBy: { "5": BOT } })).toEqual({ action: "build" });
    expect(state({ prs: [closed({ number: 5, merged: true })] })).toEqual({
      action: "build",
    });
  });

  it("метка версии — целиком: отказ от 2.1.10 не отклоняет 2.1.1", () => {
    const later = closed({
      number: 9,
      markers: ["<!-- iconavo-bot:ph@2.1.10 -->"],
    });
    expect(state({ prs: [later], closedBy: { "9": OWNER } })).toEqual({
      action: "build",
    });
    expect(hasMarker(later.markers, "iconavo-bot:ph@2.1.10")).toBe(true);
    expect(hasMarker(later.markers, MARKER)).toBe(false);
    expect(hasMarker([MARKER], MARKER)).toBe(false);
  });

  it("в ветке коммит человека, а открытого PR нет — стоп; ветка закрытого PR или робота — собрать", () => {
    const stop = state({ branch: humanTip });
    expect(stop.action).toBe("stop");
    expect(stop.problem).toContain(BRANCH);
    expect(stop.problem).toContain("Konstantin");
    // Коммит человека — последний у закрытого PR другой версии: он остался в истории этого PR.
    const leftover = closed({
      number: 4,
      markers: ["<!-- iconavo-bot:ph@2.1.0 -->"],
      headSha: SHA,
    });
    const closedBy = { "4": OWNER };
    expect(state({ prs: [leftover], closedBy, branch: humanTip })).toEqual({
      action: "build",
    });
    expect(
      state({
        prs: [{ ...leftover, headSha: OTHER_SHA }],
        closedBy,
        branch: humanTip,
      }).action,
    ).toBe("stop");
    // Последний коммит — робота: прошлый запуск отправил ветку, а PR не открыл.
    expect(state({ branch: botTip })).toEqual({ action: "build" });
    // Отказ владельца важнее: ветку не трогаем, версию не предлагаем.
    expect(
      state({
        prs: [closed({ number: 5, headSha: OTHER_SHA })],
        closedBy: { "5": OWNER },
        branch: humanTip,
      }),
    ).toEqual({ action: "rejected", rejected: 5 });
  });

  it("в main уже последняя версия: PR робота — закрыть, правят руками — ничего", () => {
    expect(
      state({ changed: false, prs: [pr({ number: 7 })], branch: botTip }),
    ).toEqual({ action: "close", open: 7 });
    expect(
      state({ changed: false, prs: [pr({ number: 7 })], branch: humanTip }),
    ).toEqual({ action: "none", open: 7 });
    expect(state({ changed: false, branch: humanTip })).toEqual({
      action: "none",
    });
  });

  it("сведения — в формате, который пишет workflow", () => {
    const parsed = factsSchema.parse({
      repo: REPO,
      changed: true,
      prs: [
        {
          number: 183,
          state: "open",
          merged: false,
          markers: [COMMENT],
          headRepo: REPO,
          headSha: SHA,
        },
        {
          number: 23,
          state: "closed",
          merged: false,
          markers: [],
          headRepo: null,
          headSha: OTHER_SHA,
        },
      ],
      closedBy: { "23": OWNER },
      branch: null,
    });
    expect(parsed.prs).toHaveLength(2);
    expect(() =>
      factsSchema.parse({
        repo: REPO,
        changed: "true",
        prs: [],
        closedBy: {},
        branch: null,
      }),
    ).toThrow();
    expect(isBot(BOT)).toBe(true);
    expect(isBot(OWNER)).toBe(false);
    expect(isBot(null)).toBe(false);
    expect(isBot(undefined)).toBe(false);
  });
});
