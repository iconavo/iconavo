import { describe, expect, it } from "vitest";
import {
  type BatchTransport,
  batchBenchFailed,
  batchSummary,
  batchVerdict,
  benchBatches,
  fetchTransport,
  formatBatchBench,
  planBatches,
  renderBatchBenchPage,
} from "./batch-bench.js";
import { parseServerTiming } from "./bench.js";

const SETS = [
  "lucide",
  "tabler",
  "material-symbols",
  "ph",
  "fluent-emoji-flat",
];
const pools = (n: number) =>
  Object.fromEntries(
    SETS.map((set) => [
      set,
      Array.from(
        { length: n },
        (_, i) => `${set}-${String(i).padStart(3, "0")}`,
      ),
    ]),
  );
/** Маленький замер для тестов: по 4 имени, 3 пачки на набор, 2 раунда. */
const SMALL = { size: 4, sequential: 15, repeats: 3, rounds: 2 };

/**
 * Часы замера: ожидания стоят в очереди и наступают по порядку времени, одновременные — вместе. Так
 * четыре пачки сразу отвечают каждая за своё время, а не одна за другой.
 */
function virtualClock() {
  let t = 0;
  const queue: { at: number; resolve: () => void }[] = [];
  let pumping = false;
  const step = () => {
    queue.sort((a, b) => a.at - b.at);
    const next = queue.shift();
    if (next === undefined) {
      pumping = false;
      return;
    }
    t = Math.max(t, next.at);
    next.resolve();
    setImmediate(step);
  };
  return {
    now: () => t,
    wait: (ms: number) =>
      new Promise<void>((resolve) => {
        queue.push({ at: t + ms, resolve });
        if (!pumping) {
          pumping = true;
          setImmediate(step);
        }
      }),
  };
}

/**
 * Поддельный edge API: ответ целиком — в кэше после первого раза, файлы имён — в кэше файлов, если
 * cacheFiles; Server-Timing — как у функции; время сети — 50 мс, файл из R2 — ещё 100 мс.
 */
function fakeApi(o: { cacheFiles: boolean; status?: number }) {
  const clock = virtualClock();
  const answers = new Set<string>();
  const files = new Set<string>();
  const paths: string[] = [];
  const transport: BatchTransport = {
    async get(path) {
      paths.push(path);
      const url = new URL(path, "https://api.example");
      const set = /^\/([a-z0-9-]+)\.json$/.exec(url.pathname)?.[1];
      const newConnection = paths.length === 1;
      if (set === undefined) {
        await clock.wait(50);
        return { status: 200, headers: {}, body: "<svg/>", newConnection };
      }
      const names = (url.searchParams.get("icons") ?? "").split(",");
      const hit = answers.has(path);
      answers.add(path);
      let timing: string;
      if (hit) {
        await clock.wait(50);
        timing = 'manifest;dur=0, cache;desc="hit";dur=1, total;dur=1';
      } else {
        const known = names.filter((n) => files.has(`${set}:${n}`));
        const looked =
          known.length === 0 ? Math.min(6, names.length) : names.length;
        const r2 = names.length - known.length;
        if (o.cacheFiles) for (const n of names) files.add(`${set}:${n}`);
        await clock.wait(50 + r2 * 100);
        timing = `cfL4;desc="?proto=TCP&rtt=1,2", manifest;dur=0, cache;desc="miss";dur=1, files;desc="${known.length}/${looked}";dur=2, r2;desc="${r2}";dur=${r2 * 100}, total;dur=${3 + r2 * 100}`;
      }
      return {
        status: o.status ?? 200,
        headers: {
          "x-cache": hit ? "HIT" : "MISS",
          "server-timing": timing,
          "cf-ray": "8f1d2c3b4a5e6f70-AMS",
          "x-iconavo-build": "b1",
          "x-iconavo-version": "0123abcd",
        },
        body: JSON.stringify({ prefix: set, icons: {} }),
        newConnection,
      };
    },
    connections: () => 1,
    close() {},
  };
  return { transport, paths, now: clock.now, sleep: clock.wait };
}

describe("pnpm api bench --batches: пачки замера", () => {
  it("новые пачки — без повторов имён, по кодам символов, наборы по кругу; тот же случай — те же пачки", () => {
    const plan = planBatches(pools(40), 7, SMALL);
    expect(plan.fresh).toHaveLength(15);
    expect(plan.fresh.map((b) => b.set).slice(0, 5)).toEqual(SETS);
    const fresh = [...plan.fresh, ...plan.parallelFresh.flat()];
    const names = fresh.flatMap((b) => b.names.map((n) => `${b.set}:${n}`));
    expect(new Set(names).size).toBe(names.length);
    for (const b of fresh) {
      expect(b.names).toHaveLength(4);
      expect(b.names).toEqual([...b.names].sort());
      expect(b.names.every((n) => n.startsWith(b.set))).toBe(true);
    }
    expect(planBatches(pools(40), 7, SMALL)).toEqual(plan);
    expect(planBatches(pools(40), 8, SMALL)).not.toEqual(plan);
  });

  it("«знакомые» — новые сочетания из имён новых пачек того же набора; в раунде — разные наборы", () => {
    const plan = planBatches(pools(40), 3, SMALL);
    const freshKeys = new Set(plan.fresh.map((b) => `${b.set}:${b.names}`));
    const known = new Set(
      plan.fresh.flatMap((b) => b.names.map((n) => `${b.set}:${n}`)),
    );
    const seen = [...plan.seen, ...plan.parallelSeen.flat()];
    const keys = seen.map((b) => `${b.set}:${b.names}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of seen) {
      expect(freshKeys.has(`${b.set}:${b.names}`)).toBe(false);
      expect(b.names.every((n) => known.has(`${b.set}:${n}`))).toBe(true);
    }
    for (const round of [...plan.parallelFresh, ...plan.parallelSeen]) {
      expect(new Set(round.map((b) => b.set)).size).toBe(4);
    }
    expect(plan.repeat).toEqual(plan.fresh.slice(0, 3));
  });

  it("мало имён в наборе — ошибка, а не повтор имён", () => {
    expect(() => planBatches(pools(10), 1, SMALL)).toThrow(/мало имён/);
  });
});

describe("pnpm api bench --batches: замер", () => {
  it("с кэшем файлов: знакомые иконки — без R2, повтор — из кэша; итог и страница", async () => {
    const api = fakeApi({ cacheFiles: true });
    const r = await benchBatches({
      base: "https://api.example",
      pools: pools(40),
      seed: 5,
      transport: api.transport,
      plan: SMALL,
      now: api.now,
      sleep: api.sleep,
    });
    // Прогрев не в замере: два запроса до первой пачки.
    expect(r.warmup.map((w) => w.path)).toEqual([
      "/lucide/heart.svg",
      "/lucide.json?icons=heart",
    ]);
    expect(api.paths[2]).toMatch(/^\/lucide\.json\?icons=/);
    const fresh = batchSummary(r.samples, "fresh");
    expect(fresh).toMatchObject({ n: 15, errors: 0, skipped: 0, p50: 450 });
    expect(fresh.within).toEqual([1, 1, 1]);
    expect(fresh).toMatchObject({ serverP50: 403, networkP50: 47, r2: 60 });
    const seen = batchSummary(r.samples, "seen");
    expect(seen).toMatchObject({ n: 15, p50: 50, r2: 0, hits: 60, looked: 60 });
    const repeat = batchSummary(r.samples, "repeat");
    expect(repeat.cache).toEqual({ HIT: 3 });
    expect(batchSummary(r.samples, "parallel-fresh").n).toBe(8);
    expect(batchSummary(r.samples, "parallel-seen").r2).toBe(0);
    expect(r.samples.every((s) => s.colo === "AMS")).toBe(true);
    expect(batchBenchFailed(r)).toBe(false);
    expect(batchVerdict(r)).toBe(
      "Новые пачки из 4 имён: P95 по одной — 450 мс, по 4 сразу — 450 мс — в пределах порога 1,5 с.",
    );
    const lines = formatBatchBench(r);
    expect(lines[1]).toBe("Дата-центр: AMS · сборка: b1 · соединений: 1");
    expect(renderBatchBenchPage(r)).toContain("Знакомые иконки в новой пачке");
  });

  it("без кэша файлов (старая сборка): знакомые иконки — тоже через R2", async () => {
    const api = fakeApi({ cacheFiles: false });
    const r = await benchBatches({
      base: "https://api.example",
      pools: pools(40),
      seed: 5,
      transport: api.transport,
      plan: SMALL,
      now: api.now,
      sleep: api.sleep,
    });
    expect(batchSummary(r.samples, "seen")).toMatchObject({ p50: 450, r2: 60 });
  });

  it("ответ не 200 — замер не годится", async () => {
    const api = fakeApi({ cacheFiles: true, status: 503 });
    const r = await benchBatches({
      base: "https://api.example",
      pools: pools(40),
      seed: 5,
      transport: api.transport,
      plan: SMALL,
      now: api.now,
      sleep: api.sleep,
    });
    expect(batchSummary(r.samples, "fresh").errors).toBe(15);
    expect(batchBenchFailed(r)).toBe(true);
    expect(batchVerdict(r)).toMatch(/данных для итога нет/);
  });

  it("fetch для превью: заголовки и тело как есть", async () => {
    const transport = fetchTransport("http://127.0.0.1:4281", async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:4281/demo.json?icons=a");
      return new Response('{"prefix":"demo"}', {
        headers: { "X-Cache": "MISS" },
      });
    });
    const reply = await transport.get("/demo.json?icons=a");
    expect(reply).toMatchObject({
      status: 200,
      body: '{"prefix":"demo"}',
      newConnection: false,
    });
    expect(reply.headers["x-cache"]).toBe("MISS");
  });
});

describe("Server-Timing", () => {
  it("записи по именам; запятая в кавычках — часть описания", () => {
    const t = parseServerTiming(
      'cfL4;desc="?proto=TCP&rtt=1,2", files;desc="28/30";dur=12, r2;desc="2";dur=140, total;dur=160',
    );
    expect(t.get("cfL4")).toEqual({ desc: "?proto=TCP&rtt=1,2" });
    expect(t.get("files")).toEqual({ desc: "28/30", dur: 12 });
    expect(t.get("total")).toEqual({ dur: 160 });
    expect(parseServerTiming(null).size).toBe(0);
  });
});
