// Замер скорости пачек — pnpm api bench --batches (шаг 6 фазы 3, ADR-0030). Протокол записан в
// ADR-0030 до замера. Пачка — BATCH_SIZE случайных видимых имён одного набора, наборы по кругу; первая
// тысяча имён каждого набора не берётся — её показывает страница «5000 иконок» песочницы. Сценарии:
// новые иконки (дата-центр видит их впервые — путь через R2), знакомые иконки в новой пачке (половины
// двух прошлых пачек — то, что ускоряет кэш файлов), повтор пачки (целый ответ из кэша — время сети),
// 4 новые пачки сразу и 4 пачки из знакомых сразу (как при загрузке страницы). Мера — время до
// последнего байта ответа. Одно соединение HTTP/2 на весь замер, как у вкладки браузера: долгий TLS —
// один раз, при прогреве; ответ, который ждал нового соединения, в итог не входит. Server-Timing
// функции — время в ней и откуда файлы; у сборки без него — прочерк.

import {
  type ClientHttp2Session,
  connect,
  constants,
  type IncomingHttpHeaders,
} from "node:http2";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { CHECK_ORIGIN } from "../cdn/config.js";
import { esc, htmlPage } from "../report/html.js";
import { textTable } from "../report/table.js";
import type { FetchFn } from "../sources/npm.js";
import { parseServerTiming, percentile } from "./bench.js";
import {
  API_CHECK_ICON,
  API_CHECK_SET,
  HIT_ATTEMPTS,
  HIT_PAUSE_MS,
} from "./config.js";

/** Имён в пачке — критерий шага 6: пачка из 30 имён без кэша укладывается в порог ядра. */
export const BATCH_SIZE = 30;
/** Пачек по одной у «новых» и у «знакомых», повторов, раундов и пачек в раунде. */
export const BATCH_SEQUENTIAL = 30;
export const BATCH_REPEATS = 10;
export const BATCH_ROUNDS = 6;
export const BATCH_PARALLEL = 4;
/** Пауза после новых пачек: функция дописывает кэш после ответа (waitUntil). */
export const BATCH_SETTLE_MS = 3000;
/** Доля пачек не дольше: нынешний порог ядра, предложенный и запасной (ADR-0030). */
export const BATCH_LIMITS_MS = [750, 1500, 2000] as const;
/** Порог, с которым сравнивает итог. */
export const BATCH_TARGET_MS = 1500;
/** Ожидание одного ответа. */
export const BATCH_TIMEOUT_MS = 20_000;
/** Сетевых сбоев больше этой доли — замер не годится, код 1. */
export const BATCH_MAX_NETWORK_ERRORS = 0.1;
/** Прогрев — не в замере: соединение и копия функции с манифестом в памяти. */
export const BATCH_WARMUP = [
  `/${API_CHECK_SET}/${API_CHECK_ICON}.svg`,
  `/${API_CHECK_SET}.json?icons=${API_CHECK_ICON}`,
] as const;

export type BatchScenario =
  | "fresh"
  | "seen"
  | "repeat"
  | "parallel-fresh"
  | "parallel-seen";

export const BATCH_SCENARIOS: readonly {
  id: BatchScenario;
  title: string;
  note: string;
}[] = [
  {
    id: "fresh",
    title: "Новые иконки",
    note: "дата-центр видит иконки впервые: путь через R2",
  },
  {
    id: "seen",
    title: "Знакомые иконки в новой пачке",
    note: "половины двух прошлых пачек: то, что ускоряет кэш файлов",
  },
  {
    id: "repeat",
    title: "Повтор пачки",
    note: "целый ответ из кэша: время сети",
  },
  {
    id: "parallel-fresh",
    title: "4 новые пачки сразу",
    note: "всплеск при загрузке страницы",
  },
  {
    id: "parallel-seen",
    title: "4 пачки из знакомых сразу",
    note: "тот же всплеск на знакомых иконках",
  },
];

/** У этих сценариев файлы не должны быть в кэше: попавшие туда пачки в итог не входят. */
const FRESH = new Set<BatchScenario>(["fresh", "parallel-fresh"]);

export interface Batch {
  set: string;
  /** По кодам символов, как их шлёт ядро. */
  names: string[];
}

export interface BatchPlan {
  fresh: Batch[];
  seen: Batch[];
  repeat: Batch[];
  parallelFresh: Batch[][];
  parallelSeen: Batch[][];
}

export interface PlanOptions {
  size?: number;
  sequential?: number;
  repeats?: number;
  rounds?: number;
  parallel?: number;
}

/** Случайные числа по номеру случая (mulberry32): тот же номер — те же пачки. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Пачки замера: имена без повторов, «знакомые» — из половин новых пачек того же набора. */
export function planBatches(
  pools: Readonly<Record<string, readonly string[]>>,
  seed: number,
  o: PlanOptions = {},
): BatchPlan {
  const size = o.size ?? BATCH_SIZE;
  const sequential = o.sequential ?? BATCH_SEQUENTIAL;
  const parallel = o.parallel ?? BATCH_PARALLEL;
  const sets = Object.keys(pools);
  if (sets.length < parallel) {
    throw new Error(`для замера нужно хотя бы ${parallel} набора`);
  }
  if (sequential < sets.length * 3) {
    throw new Error(
      `пачек по одной нужно хотя бы ${sets.length * 3}: по три на набор`,
    );
  }
  const random = seeded(seed);
  const shuffled = new Map<string, string[]>();
  for (const set of sets) {
    const list = [...(pools[set] ?? [])];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j] as string, list[i] as string];
    }
    shuffled.set(set, list);
  }
  const taken = new Map<string, number>();
  const take = (set: string): Batch => {
    const from = taken.get(set) ?? 0;
    const names = (shuffled.get(set) ?? []).slice(from, from + size);
    if (names.length < size) {
      throw new Error(`в наборе «${set}» мало имён для замера`);
    }
    taken.set(set, from + size);
    return { set, names: names.sort() };
  };
  const setAt = (i: number) => sets[i % sets.length] as string;
  const fresh = Array.from({ length: sequential }, (_, i) => take(setAt(i)));
  const half = Math.floor(size / 2);
  /** Новая пачка из знакомых иконок: первая половина одной новой пачки и вторая — другой. */
  const mix = (set: string, k: number, step: number): Batch => {
    const own = fresh.filter((b) => b.set === set);
    const a = own[k % own.length] as Batch;
    const b = own[(k + step) % own.length] as Batch;
    return {
      set,
      names: [...a.names.slice(0, half), ...b.names.slice(half)].sort(),
    };
  };
  const seen = Array.from({ length: sequential }, (_, i) =>
    mix(setAt(i), Math.floor(i / sets.length), 1),
  );
  const rounds = o.rounds ?? BATCH_ROUNDS;
  const parallelFresh = Array.from({ length: rounds }, (_, r) =>
    Array.from({ length: parallel }, (_, j) => take(setAt(r + j))),
  );
  const uses = new Map<string, number>();
  const parallelSeen = Array.from({ length: rounds }, (_, r) =>
    Array.from({ length: parallel }, (_, j) => {
      const set = setAt(r + j);
      const k = uses.get(set) ?? 0;
      uses.set(set, k + 1);
      return mix(set, k, 2);
    }),
  );
  return {
    fresh,
    seen,
    repeat: fresh.slice(0, o.repeats ?? BATCH_REPEATS),
    parallelFresh,
    parallelSeen,
  };
}

/** Ответ хоста: заголовки строчными именами, тело — уже без сжатия. */
export interface BatchReply {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Запрос ждал открытия соединения: в его времени — TLS. */
  newConnection: boolean;
}

export interface BatchTransport {
  get(path: string): Promise<BatchReply>;
  /** Сколько раз открывалось соединение; у fetch — неизвестно. */
  connections(): number | undefined;
  close(): void;
}

const headerRecord = (headers: IncomingHttpHeaders): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith(":") || value === undefined) continue;
    out[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
};

const decode = (body: Buffer, encoding: string | undefined) =>
  (encoding === "br"
    ? brotliDecompressSync(body)
    : encoding === "gzip"
      ? gunzipSync(body)
      : body
  ).toString("utf8");

/**
 * Одно соединение HTTP/2 на весь замер (node:http2): одновременные запросы идут по нему же, как у
 * вкладки браузера. Оборвалось или запрос не дождался ответа — следующий откроет новое.
 */
export function http2Transport(
  base: string,
  timeoutMs = BATCH_TIMEOUT_MS,
): BatchTransport {
  let session: ClientHttp2Session | undefined;
  let connecting = false;
  let opened = 0;
  const open = () => {
    const s = connect(base);
    opened++;
    connecting = true;
    s.once("connect", () => {
      connecting = false;
    });
    // Ошибка соединения приходит и запросам — здесь её только не роняем.
    s.on("error", () => {});
    s.once("close", () => {
      if (session === s) session = undefined;
    });
    session = s;
    return s;
  };
  return {
    get(path) {
      const s =
        session !== undefined && !session.closed && !session.destroyed
          ? session
          : open();
      const newConnection = connecting;
      return new Promise((resolve, reject) => {
        const request = s.request({
          ":path": path,
          "accept-encoding": "br, gzip",
          origin: CHECK_ORIGIN,
        });
        const chunks: Buffer[] = [];
        let status = 0;
        let headers: Record<string, string> = {};
        const timer = setTimeout(() => {
          request.close(constants.NGHTTP2_CANCEL);
          s.destroy();
          reject(new Error(`нет ответа за ${timeoutMs / 1000} с`));
        }, timeoutMs);
        request.on("response", (h) => {
          status = Number(h[":status"]);
          headers = headerRecord(h);
        });
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          clearTimeout(timer);
          try {
            resolve({
              status,
              headers,
              body: decode(Buffer.concat(chunks), headers["content-encoding"]),
              newConnection,
            });
          } catch (e) {
            reject(e);
          }
        });
        request.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        request.end();
      });
    },
    connections: () => opened,
    close() {
      session?.close();
    },
  };
}

/** fetch — для превью на 127.0.0.1 и для тестов. */
export function fetchTransport(
  base: string,
  fetchFn: FetchFn = fetch,
  timeoutMs = BATCH_TIMEOUT_MS,
): BatchTransport {
  return {
    async get(path) {
      const res = await fetchFn(`${base}${path}`, {
        headers: { origin: CHECK_ORIGIN },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.text();
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers),
        body,
        newConnection: false,
      };
    },
    connections: () => undefined,
    close() {},
  };
}

export interface BatchSample {
  scenario: BatchScenario;
  set: string;
  names: number;
  /** Номер раунда одновременных пачек. */
  round?: number;
  status?: number;
  /** Время до последнего байта ответа, мс. */
  ms: number;
  cache?: string;
  /** Server-Timing: время в функции; файлов нашлось в кэше / искали; прочитано из R2. */
  serverMs?: number;
  hits?: number;
  looked?: number;
  r2?: number;
  colo?: string;
  build?: string;
  version?: string;
  newConnection?: boolean;
  error?: string;
}

export interface BatchBenchReport {
  base: string;
  /** Время начала, ISO. */
  at: string;
  seed: number;
  size: number;
  warmup: { path: string; ms: number; status?: number; error?: string }[];
  samples: BatchSample[];
  connections?: number;
  ms: number;
}

export interface BatchBenchOptions {
  base: string;
  pools: Readonly<Record<string, readonly string[]>>;
  seed: number;
  transport: BatchTransport;
  plan?: PlanOptions;
  settleMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** Что сказал ответ: код, кэш, Server-Timing, дата-центр, что это IconifyJSON нужного набора. */
function readReply(sample: BatchSample, reply: BatchReply): void {
  const h = reply.headers;
  sample.status = reply.status;
  if (reply.newConnection) sample.newConnection = true;
  if (h["x-cache"] !== undefined) sample.cache = h["x-cache"];
  const timing = parseServerTiming(h["server-timing"]);
  const total = timing.get("total")?.dur;
  if (total !== undefined) sample.serverMs = total;
  const files = /^(\d+)\/(\d+)$/.exec(timing.get("files")?.desc ?? "");
  if (files) {
    sample.hits = Number(files[1]);
    sample.looked = Number(files[2]);
  }
  const r2 = timing.get("r2")?.desc;
  if (r2 !== undefined && /^\d+$/.test(r2)) sample.r2 = Number(r2);
  const colo = /-([A-Z]{3})$/.exec(h["cf-ray"] ?? "")?.[1];
  if (colo !== undefined) sample.colo = colo;
  if (h["x-iconavo-build"] !== undefined) sample.build = h["x-iconavo-build"];
  if (h["x-iconavo-version"] !== undefined) {
    sample.version = h["x-iconavo-version"];
  }
  if (reply.status !== 200) {
    sample.error = `ответ ${reply.status}`;
    return;
  }
  try {
    const data = JSON.parse(reply.body) as { prefix?: unknown };
    if (data.prefix !== sample.set) sample.error = "ответ не того набора";
  } catch {
    sample.error = "ответ не JSON";
  }
}

export async function benchBatches(
  o: BatchBenchOptions,
): Promise<BatchBenchReport> {
  const now = o.now ?? (() => performance.now());
  const sleep =
    o.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const settle = o.settleMs ?? BATCH_SETTLE_MS;
  const plan = planBatches(o.pools, o.seed, o.plan);
  const started = now();
  const at = new Date().toISOString();
  const samples: BatchSample[] = [];

  const warmup: BatchBenchReport["warmup"] = [];
  for (const path of BATCH_WARMUP) {
    const t0 = now();
    try {
      const reply = await o.transport.get(path);
      warmup.push({ path, ms: now() - t0, status: reply.status });
    } catch (e) {
      warmup.push({ path, ms: now() - t0, error: (e as Error).message });
    }
  }

  const run = async (
    scenario: BatchScenario,
    batch: Batch,
    round?: number,
  ): Promise<BatchSample> => {
    const sample: BatchSample = {
      scenario,
      set: batch.set,
      names: batch.names.length,
      ms: 0,
      ...(round === undefined ? {} : { round }),
    };
    const t0 = now();
    try {
      const reply = await o.transport.get(
        `/${batch.set}.json?icons=${batch.names.join(",")}`,
      );
      sample.ms = now() - t0;
      readReply(sample, reply);
    } catch (e) {
      sample.ms = now() - t0;
      sample.error = (e as Error).message;
    }
    return sample;
  };
  const one = async (scenario: BatchScenario, batches: readonly Batch[]) => {
    for (const batch of batches) samples.push(await run(scenario, batch));
  };
  const rounds = async (scenario: BatchScenario, list: readonly Batch[][]) => {
    for (const [r, round] of list.entries()) {
      samples.push(
        ...(await Promise.all(round.map((batch) => run(scenario, batch, r)))),
      );
    }
  };
  const done = (scenario: BatchScenario) =>
    o.log?.(
      `  ${BATCH_SCENARIOS.find((s) => s.id === scenario)?.title}: ${samples.filter((s) => s.scenario === scenario).length} пачек`,
    );

  await one("fresh", plan.fresh);
  done("fresh");
  await sleep(settle);
  await one("seen", plan.seen);
  done("seen");
  // Повтор должен прийти из кэша ответа: запись идёт после ответа, как у pnpm api check.
  for (const batch of plan.repeat) {
    let sample = await run("repeat", batch);
    for (
      let i = 1;
      i < HIT_ATTEMPTS && sample.error === undefined && sample.cache !== "HIT";
      i++
    ) {
      await sleep(HIT_PAUSE_MS);
      sample = await run("repeat", batch);
    }
    samples.push(sample);
  }
  done("repeat");
  await rounds("parallel-fresh", plan.parallelFresh);
  done("parallel-fresh");
  await sleep(settle);
  await rounds("parallel-seen", plan.parallelSeen);
  done("parallel-seen");

  const connections = o.transport.connections();
  return {
    base: o.base,
    at,
    seed: o.seed,
    size: o.plan?.size ?? BATCH_SIZE,
    warmup,
    samples,
    ...(connections === undefined ? {} : { connections }),
    ms: now() - started,
  };
}

export interface BatchSummary {
  scenario: BatchScenario;
  /** Пачек в итоге; ошибок; не вошли — ждали соединения или (у новых) файлы уже были в кэше. */
  n: number;
  errors: number;
  skipped: number;
  p50: number;
  p95: number;
  max: number;
  /** Доля пачек в итоге не дольше каждого из BATCH_LIMITS_MS. */
  within: number[];
  serverP50: number;
  serverP95: number;
  networkP50: number;
  /** Суммы по пачкам итога: файлов нашлось в кэше, искали, прочитано из R2. */
  hits: number;
  looked: number;
  r2: number;
  /** Пачек, у которых был Server-Timing с файлами. */
  timed: number;
  cache: Record<string, number>;
}

export function batchSummary(
  samples: readonly BatchSample[],
  scenario: BatchScenario,
): BatchSummary {
  const own = samples.filter((s) => s.scenario === scenario);
  const ok = own.filter((s) => s.error === undefined);
  const counted = ok.filter(
    (s) => !s.newConnection && !(FRESH.has(scenario) && (s.hits ?? 0) > 0),
  );
  const times = counted.map((s) => s.ms);
  const server = counted.flatMap((s) =>
    s.serverMs === undefined ? [] : [s.serverMs],
  );
  const network = counted.flatMap((s) =>
    s.serverMs === undefined ? [] : [s.ms - s.serverMs],
  );
  const cache: Record<string, number> = {};
  for (const s of counted) {
    const k = s.cache ?? "—";
    cache[k] = (cache[k] ?? 0) + 1;
  }
  const timed = counted.filter((s) => s.looked !== undefined);
  const sum = (field: "hits" | "looked" | "r2") =>
    timed.reduce((total, s) => total + (s[field] ?? 0), 0);
  return {
    scenario,
    n: counted.length,
    errors: own.length - ok.length,
    skipped: ok.length - counted.length,
    p50: percentile(times, 0.5),
    p95: percentile(times, 0.95),
    max: times.length === 0 ? Number.NaN : Math.max(...times),
    within: BATCH_LIMITS_MS.map((limit) =>
      counted.length === 0
        ? 0
        : times.filter((t) => t <= limit).length / counted.length,
    ),
    serverP50: percentile(server, 0.5),
    serverP95: percentile(server, 0.95),
    networkP50: percentile(network, 0.5),
    hits: sum("hits"),
    looked: sum("looked"),
    r2: sum("r2"),
    timed: timed.length,
    cache,
  };
}

/** Код 1: ответ не 200 или не тот, либо сетевых сбоев больше 10%. */
export function batchBenchFailed(r: BatchBenchReport): boolean {
  const wrong = r.samples.some(
    (s) => s.error !== undefined && s.status !== undefined,
  );
  const network = r.samples.filter((s) => s.status === undefined).length;
  return wrong || network > r.samples.length * BATCH_MAX_NETWORK_ERRORS;
}

const msText = (ms: number) =>
  Number.isNaN(ms) ? "—" : `${Math.round(ms)} мс`;
const secondsText = (ms: number) => `${String(ms / 1000).replace(".", ",")} с`;
const pctText = (x: number) => `${Math.round(x * 100)}%`;
const unique = (values: (string | undefined)[]) =>
  [...new Set(values.filter((v): v is string => v !== undefined))].sort();

/** Итог: новые пачки по одной и по 4 сразу против порога. */
export function batchVerdict(
  r: BatchBenchReport,
  limitMs = BATCH_TARGET_MS,
): string {
  const single = batchSummary(r.samples, "fresh").p95;
  const burst = batchSummary(r.samples, "parallel-fresh").p95;
  const head = `Новые пачки из ${r.size} имён: P95 по одной — ${msText(single)}, по 4 сразу — ${msText(burst)}`;
  if (Number.isNaN(single) || Number.isNaN(burst)) {
    return `${head} — данных для итога нет.`;
  }
  return `${head} — ${single <= limitMs && burst <= limitMs ? "в пределах" : "дольше"} порога ${secondsText(limitMs)}.`;
}

/** Строки сводки: шапка и таблица по сценариям. */
function summaryRows(r: BatchBenchReport): string[][] {
  return BATCH_SCENARIOS.map(({ id, title }) => {
    const s = batchSummary(r.samples, id);
    return [
      title,
      String(s.n),
      msText(s.p50),
      msText(s.p95),
      msText(s.max),
      ...s.within.map(pctText),
      msText(s.serverP50),
      msText(s.networkP50),
      s.timed === 0 ? "—" : `${s.hits}/${s.looked}`,
      s.timed === 0 ? "—" : (s.r2 / s.timed).toFixed(1).replace(".", ","),
      String(s.errors),
    ];
  });
}

const SUMMARY_HEAD = [
  "Сценарий",
  "Пачек",
  "P50",
  "P95",
  "Дольше всех",
  ...BATCH_LIMITS_MS.map((ms) => `≤ ${secondsText(ms)}`),
  "В функции P50",
  "Сеть P50",
  "Файлы из кэша",
  "Из R2 на пачку",
  "Ошибок",
];

function headerLines(r: BatchBenchReport): string[] {
  const colos = unique(r.samples.map((s) => s.colo));
  const builds = unique(r.samples.map((s) => s.build));
  const skipped = BATCH_SCENARIOS.reduce(
    (total, { id }) => total + batchSummary(r.samples, id).skipped,
    0,
  );
  return [
    `Замер скорости пачек ${r.base} — по ${r.size} имён, случай ${r.seed}; ${r.samples.length} пачек за ${secondsText(Math.round(r.ms / 100) * 100)}`,
    `Дата-центр: ${colos.join(", ") || "—"} · сборка: ${builds.join(", ") || "—"} · соединений: ${r.connections ?? "—"}`,
    `Прогрев (в итог не входит): ${r.warmup.map((w) => `${w.path} — ${w.error ?? msText(w.ms)}`).join("; ")}`,
    ...(skipped === 0
      ? []
      : [
          `Не вошли в итог: ${skipped} — ждали нового соединения или файлы «новых» иконок уже были в кэше.`,
        ]),
  ];
}

/** Строки для терминала. */
export function formatBatchBench(r: BatchBenchReport): string[] {
  return [
    ...headerLines(r),
    textTable(SUMMARY_HEAD, summaryRows(r)),
    batchVerdict(r),
  ];
}

/** Страница отчёта .cache/reports/api/bench-batches.html. */
export function renderBatchBenchPage(r: BatchBenchReport): string {
  const titles = new Map(BATCH_SCENARIOS.map((s) => [s.id, s.title]));
  const summary = `<table><thead><tr>${SUMMARY_HEAD.map((h, i) => `<th${i === 0 ? "" : ' class="num"'}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${summaryRows(
    r,
  )
    .map(
      (row) =>
        `<tr>${row.map((cell, i) => `<td${i === 0 ? "" : ' class="num"'}>${esc(cell)}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
  const samples = `<table><thead><tr><th>Сценарий</th><th class="num">Раунд</th><th>Набор</th><th class="num">Имён</th><th class="num">Ответ</th><th class="num">Время</th><th>X-Cache</th><th class="num">В функции</th><th class="num">Файлы из кэша</th><th class="num">Из R2</th><th>Дата-центр</th></tr></thead><tbody>${r.samples
    .map(
      (s) =>
        `<tr><td>${esc(titles.get(s.scenario) ?? s.scenario)}${s.newConnection ? ' <span class="muted">новое соединение</span>' : ""}</td><td class="num">${s.round === undefined ? "—" : s.round + 1}</td><td>${esc(s.set)}</td><td class="num">${s.names}</td><td class="num">${esc(s.error ?? String(s.status ?? "—"))}</td><td class="num${s.ms > BATCH_TARGET_MS ? " stop" : ""}">${msText(s.ms)}</td><td>${esc(s.cache ?? "—")}</td><td class="num">${s.serverMs === undefined ? "—" : msText(s.serverMs)}</td><td class="num">${s.looked === undefined ? "—" : `${s.hits}/${s.looked}`}</td><td class="num">${s.r2 ?? "—"}</td><td>${esc(s.colo ?? "—")}</td></tr>`,
    )
    .join("")}</tbody></table>`;
  return htmlPage(
    "Скорость пачек",
    "",
    `<h1>Скорость пачек</h1>
<p class="muted">${esc(r.base)} · ${esc(r.at)} · шаг 6 фазы 3, ADR-0030. Мера — время до последнего байта ответа; пачки по ${r.size} имён, которых нет в кэше ответов.</p>
<pre>${esc(headerLines(r).join("\n"))}</pre>
${summary}
<p><strong>${esc(batchVerdict(r))}</strong></p>
<ul>${BATCH_SCENARIOS.map((s) => `<li><strong>${esc(s.title)}</strong> — ${esc(s.note)}.</li>`).join("")}</ul>
<h2>Все пачки</h2>
${samples}`,
  );
}
