// Проверка edge API по живым адресам (ADR-0024, ADR-0023): ответы функции сверяются со статикой той
// же версии на cdn.iconavo.dev. Сначала — ожидание: функция перечитывает манифест раз в минуту, а
// при первой выкладке её на адресе может ещё не быть. Затем пачка в двух порядках (второй ответ — из
// кэша и побайтно тот же), SVG без параметров (равен файлу статики), с цветом и размером, с поворотом
// и отражением, CSS, каталог наборов (шаг 2 фазы 4: /collections, /collection, /last-modified,
// /changelog — сверка с манифестом), ответы 400 и 404 и переход с http. К каждому ответу 200 — два
// запроса, как у статики: с Origin и «br, gzip» и без Origin только с gzip. Ключи не нужны.

import { isDeepStrictEqual } from "node:util";
import {
  addIssue,
  type CheckGroup,
  type CheckIssue,
  type Fetched,
  type LiveGetOptions,
  liveGet,
  mismatch,
  shown,
} from "../cdn/check.js";
import {
  CHECK_MAX_ATTEMPTS,
  CHECK_ORIGIN,
  CHECK_TIMEOUT_MS,
  CORS_ALLOW_ORIGIN,
  HTTPS_REDIRECTS,
  MANIFEST_FILE,
  SECURITY_HEADERS,
  SVG_CSP,
  VERSIONS_DIR,
} from "../cdn/config.js";
import { manifestSchema } from "../cdn/files.js";
import type { FetchFn } from "../sources/npm.js";
import {
  API_CACHE_CATALOG,
  API_CACHE_OK,
  API_CHECK_ABSENT,
  API_CHECK_ALIAS,
  API_CHECK_ALIAS_PARENT,
  API_CHECK_ICON,
  API_CHECK_MISSING,
  API_CHECK_SET,
  API_CHECK_TRANSFORM,
  API_HOST,
  API_TYPES,
  API_WAIT_MS,
  API_WAIT_STEP_MS,
  HIT_ATTEMPTS,
  HIT_PAUSE_MS,
  STATIC_HOST,
} from "./config.js";

/** Вид адреса edge API — от него зависят ожидания. */
export type ApiCheckKind =
  | "batch"
  | "batch-order"
  | "svg"
  | "svg-params"
  | "svg-transform"
  | "css"
  | "collections"
  | "collection"
  | "last-modified"
  | "changelog"
  | "missing-set"
  | "missing-icon"
  | "missing-collection"
  | "collection-prefix"
  | "redirect";

export interface ApiTarget {
  kind: ApiCheckKind;
  /** Путь с параметрами от корня хоста; у перехода — «… по http». */
  path: string;
  status?: number;
  checked: CheckGroup[];
  issues: CheckIssue[];
  /** Время первого ответа. */
  ms?: number;
}

export interface ApiCheckReport {
  host: string;
  set: string;
  /** Версия набора-образца в манифесте R2. */
  version?: string;
  /** Сборка, которая ответила (X-Iconavo-Build). */
  build?: string;
  expectBuild?: string;
  /** Отпечаток оглавления каталога в манифесте R2; нет — каталог ещё не выложен. */
  catalog?: string;
  targets: ApiTarget[];
  stop: string[];
  /** Что не проверялось и почему — не проблема. */
  notes: string[];
  requests: number;
  ms: number;
  /** Сколько ждали, пока API отдаст версию из манифеста. */
  waitedMs: number;
}

export interface ApiCheckOptions {
  /** Текст манифеста R2 — его уже прочитал pnpm cdn check; нет — читается с cdn.iconavo.dev. */
  manifest?: string;
  /** Сборка, которую только что выложил CI: ждать и проверять её. */
  expectBuild?: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
  waitMs?: number;
  waitStepMs?: number;
  log?: (line: string) => void;
}

export const apiCheckFailed = (r: ApiCheckReport) =>
  r.stop.length > 0 || r.targets.some((t) => t.issues.length > 0);

const utf8 = (body: Uint8Array) => Buffer.from(body).toString("utf8");

function parse(body: Uint8Array): unknown {
  try {
    return JSON.parse(utf8(body));
  } catch {
    return undefined;
  }
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;

export async function checkApi(
  options: ApiCheckOptions = {},
): Promise<ApiCheckReport> {
  const fetchFn = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const started = now();
  let requests = 0;
  const live: LiveGetOptions = {
    fetch: fetchFn,
    sleep,
    timeoutMs: options.timeoutMs ?? CHECK_TIMEOUT_MS,
    maxAttempts: options.maxAttempts ?? CHECK_MAX_ATTEMPTS,
    onRequest: () => {
      requests++;
    },
  };
  const api = (
    path: string,
    headers: Record<string, string> = {},
    scheme: "https" | "http" = "https",
  ) => liveGet(`${scheme}://${API_HOST}/${path}`, headers, live);
  const fromStatic = (path: string) =>
    liveGet(`https://${STATIC_HOST}/${path}`, {}, live);

  const set = API_CHECK_SET;
  const targets: ApiTarget[] = [];
  const stop: string[] = [];
  const notes: string[] = [];
  let version: string | undefined;
  let lastModified: number | undefined;
  let build: string | undefined;
  let catalog: string | undefined;
  /** Наборы манифеста R2: набор → время выпуска — с ними сверяется каталог. */
  let sets: Record<string, number> = {};
  let waitedMs = 0;
  const report = (): ApiCheckReport => ({
    host: API_HOST,
    set,
    version,
    build,
    ...(options.expectBuild === undefined
      ? {}
      : { expectBuild: options.expectBuild }),
    ...(catalog === undefined ? {} : { catalog }),
    targets,
    stop,
    notes,
    requests,
    ms: now() - started,
    waitedMs,
  });
  const done = (target: ApiTarget) => {
    targets.push(target);
    options.log?.(
      `${target.path} — ${target.issues.length === 0 ? "ок" : "не так"}`,
    );
  };

  /** Пачка по http://: постоянный переход на тот же адрес по https. */
  async function checkRedirect(): Promise<ApiTarget> {
    const path = `${set}.json?icons=${API_CHECK_ICON}`;
    const target: ApiTarget = {
      kind: "redirect",
      path: `${path} по http`,
      checked: ["status"],
      issues: [],
    };
    const res = await api(path, {}, "http");
    if ("error" in res) {
      addIssue(target, "status", res.error);
      return target;
    }
    target.status = res.status;
    target.checked.push("https");
    if (!HTTPS_REDIRECTS.includes(res.status)) {
      addIssue(
        target,
        "https",
        `http:// не переводит на https: ответ ${res.status} вместо ${HTTPS_REDIRECTS.join(" или ")}`,
      );
    } else {
      addIssue(
        target,
        "https",
        mismatch(
          res.headers,
          "location",
          `https://${API_HOST}/${path}`,
          " — переход не на тот же адрес по https",
        ),
      );
    }
    return target;
  }

  /** CORS и защита — у любого ответа функции, включая ошибки. */
  function corsAndSecurity(target: ApiTarget, res: Fetched, csp: boolean) {
    target.checked.push("cors", "security");
    addIssue(
      target,
      "cors",
      mismatch(res.headers, "access-control-allow-origin", CORS_ALLOW_ORIGIN),
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      addIssue(target, "security", mismatch(res.headers, name, value));
    }
    if (csp) {
      addIssue(
        target,
        "security",
        mismatch(res.headers, "content-security-policy", SVG_CSP),
      );
    }
  }

  /**
   * Ответ 200: тип, кэш, версия и сборка, сжатие; второй запрос — gzip без Origin. У каталога свой
   * Cache-Control и своя версия — отпечаток оглавления.
   */
  async function check200(
    kind: ApiCheckKind,
    path: string,
    type: string,
    expect: {
      csp?: boolean;
      hit?: boolean;
      cache?: string;
      version?: string;
    } = {},
  ): Promise<{ target: ApiTarget; body?: Uint8Array }> {
    const target: ApiTarget = { kind, path, checked: ["status"], issues: [] };
    const headers = { origin: CHECK_ORIGIN, "accept-encoding": "br, gzip" };
    const t0 = now();
    let first = await api(path, headers);
    target.ms = now() - t0;
    // Запись в кэш идёт после ответа (waitUntil): HIT может прийти не с первого раза.
    for (
      let attempt = 1;
      expect.hit &&
      attempt < HIT_ATTEMPTS &&
      !("error" in first) &&
      first.headers.get("x-cache") !== "HIT";
      attempt++
    ) {
      await sleep(HIT_PAUSE_MS);
      first = await api(path, headers);
    }
    if ("error" in first) {
      addIssue(target, "status", first.error);
      return { target };
    }
    target.status = first.status;
    corsAndSecurity(target, first, expect.csp ?? false);
    if (first.status !== 200) {
      addIssue(target, "status", `ответ ${first.status} вместо 200`);
      return { target };
    }
    target.checked.push("type", "cache", "edge", "encoding");
    addIssue(target, "type", mismatch(first.headers, "content-type", type));
    addIssue(
      target,
      "cache",
      mismatch(first.headers, "cache-control", expect.cache ?? API_CACHE_OK),
    );
    const server = first.headers.get("server");
    if (!server?.toLowerCase().startsWith("cloudflare")) {
      addIssue(
        target,
        "edge",
        `ответ пришёл не от Cloudflare: Server ${shown(server)}`,
      );
    }
    addIssue(
      target,
      "edge",
      mismatch(
        first.headers,
        "x-iconavo-version",
        expect.version ?? (version as string),
        expect.version === catalog && catalog !== undefined
          ? " — каталог не тот, что в манифесте R2"
          : " — версия набора не та, что в манифесте R2",
      ),
    );
    if (options.expectBuild !== undefined) {
      addIssue(
        target,
        "edge",
        mismatch(
          first.headers,
          "x-iconavo-build",
          options.expectBuild,
          " — отвечает не та сборка функции",
        ),
      );
    }
    if (expect.hit) {
      addIssue(
        target,
        "edge",
        mismatch(
          first.headers,
          "x-cache",
          "HIT",
          ` — повтор не из кэша за ${HIT_ATTEMPTS} попытки`,
        ),
      );
    }
    addIssue(
      target,
      "encoding",
      mismatch(
        first.headers,
        "content-encoding",
        "br",
        " на запрос «br, gzip»",
      ),
    );
    const second = await api(path, { "accept-encoding": "gzip" });
    if ("error" in second) {
      addIssue(target, "encoding", `запрос «gzip»: ${second.error}`);
    } else if (second.status !== 200) {
      addIssue(
        target,
        "status",
        `ответ ${second.status} вместо 200 на запрос «gzip»`,
      );
    } else {
      addIssue(
        target,
        "encoding",
        mismatch(
          second.headers,
          "content-encoding",
          "gzip",
          " на запрос «gzip»",
        ),
      );
      if (Buffer.compare(first.body, second.body) !== 0) {
        addIssue(
          target,
          "encoding",
          "распакованные ответы на «br, gzip» и «gzip» разные",
        );
      }
      if (!target.issues.some((i) => i.group === "cors")) {
        addIssue(
          target,
          "cors",
          mismatch(
            second.headers,
            "access-control-allow-origin",
            CORS_ALLOW_ORIGIN,
            " на запрос без Origin",
          ),
        );
      }
    }
    return { target, body: first.body };
  }

  /** Ошибка функции: 404 (или другой код) с JSON и кодом ошибки, CORS и защита. */
  async function check404(
    kind: ApiCheckKind,
    path: string,
    code: string,
    status = 404,
  ): Promise<ApiTarget> {
    const target: ApiTarget = { kind, path, checked: ["status"], issues: [] };
    const res = await api(path, { origin: CHECK_ORIGIN });
    if ("error" in res) {
      addIssue(target, "status", res.error);
      return target;
    }
    target.status = res.status;
    corsAndSecurity(target, res, false);
    if (res.status !== status) {
      addIssue(target, "status", `ответ ${res.status} вместо ${status}`);
      return target;
    }
    target.checked.push("type", "body");
    addIssue(
      target,
      "type",
      mismatch(res.headers, "content-type", API_TYPES.json),
    );
    const error = field(parse(res.body), "error");
    if (error !== code) {
      addIssue(
        target,
        "body",
        `ошибка ${shown(String(error))} вместо «${code}»`,
      );
    }
    return target;
  }

  /**
   * Ожидание каталога: функция и «Выкладка» после слияния выкладываются параллельно, а манифест
   * функция перечитывает раз в минуту. Ждём, пока /collections отдаст оглавление из манифеста R2.
   */
  async function waitCatalog(hash: string): Promise<boolean> {
    const waitMs = options.waitMs ?? API_WAIT_MS;
    const step = options.waitStepMs ?? API_WAIT_STEP_MS;
    const start = now();
    for (;;) {
      const res = await api("collections");
      let last: string;
      if ("error" in res) {
        last = res.error;
      } else {
        const v = res.headers.get("x-iconavo-version");
        if (res.status === 200 && v === hash) {
          waitedMs += now() - start;
          return true;
        }
        last = `ответ ${res.status}, X-Iconavo-Version ${shown(v)}`;
      }
      if (now() - start + step > waitMs) {
        waitedMs += now() - start;
        stop.push(
          `API не отдал каталог ${hash} за ${Math.round(waitMs / 1000)} с; последний ответ — ${last}`,
        );
        return false;
      }
      options.log?.(`жду каталог ${hash}: ${last}`);
      await sleep(step);
    }
  }

  /** Каталог наборов: сверка с манифестом R2, у набора-образца — тело /collection и выпуски. */
  async function checkCatalog(hash: string, setVersion: string) {
    const ids = Object.keys(sets).sort();
    const atCatalog = { cache: API_CACHE_CATALOG, version: hash };

    const all = await check200(
      "collections",
      "collections",
      API_TYPES.json,
      atCatalog,
    );
    let listedInfo: unknown;
    if (all.body !== undefined) {
      all.target.checked.push("body");
      const data = parse(all.body);
      const listed =
        typeof data === "object" && data !== null
          ? Object.keys(data).sort()
          : [];
      if (listed.join(",") !== ids.join(",")) {
        addIssue(
          all.target,
          "body",
          `наборы ${listed.join(", ") || "—"} вместо наборов манифеста ${ids.join(", ")}`,
        );
      }
      const broken = listed.find((id) => {
        const info = field(data, id);
        return (
          typeof field(info, "name") !== "string" ||
          typeof field(info, "total") !== "number" ||
          typeof field(field(info, "license"), "title") !== "string"
        );
      });
      if (broken !== undefined) {
        addIssue(
          all.target,
          "body",
          `у «${broken}» нет name, total или license.title — не IconifyInfo`,
        );
      }
      listedInfo = field(data, set);
    }
    done(all.target);

    const one = await check200(
      "collection",
      `collection?prefix=${set}&info=true`,
      API_TYPES.json,
      { cache: API_CACHE_CATALOG, version: setVersion },
    );
    if (one.body !== undefined) {
      one.target.checked.push("body");
      const data = parse(one.body);
      const info = field(data, "info");
      const total = field(data, "total");
      const categories = field(data, "categories");
      const uncategorized = field(data, "uncategorized");
      const names = new Set([
        ...(Array.isArray(uncategorized) ? uncategorized : []),
        ...(typeof categories === "object" && categories !== null
          ? Object.values(categories).flat()
          : []),
      ]);
      if (field(data, "prefix") !== set) {
        addIssue(one.target, "body", `prefix не «${set}»`);
      }
      if (total !== field(info, "total") || names.size !== total) {
        addIssue(
          one.target,
          "body",
          `в категориях и uncategorized ${names.size} имён, total ${String(total)}, info.total ${String(field(info, "total"))} — должны совпасть`,
        );
      }
      if (typeof field(field(info, "license"), "text") !== "string") {
        addIssue(one.target, "body", "в info.license нет полного текста");
      }
      for (const key of ["name", "total", "version"]) {
        if (field(info, key) !== field(listedInfo, key)) {
          addIssue(one.target, "body", `info.${key} не как в /collections`);
        }
      }
    }
    done(one.target);

    const modified = await check200(
      "last-modified",
      "last-modified",
      API_TYPES.json,
      atCatalog,
    );
    if (modified.body !== undefined) {
      modified.target.checked.push("body");
      if (
        !isDeepStrictEqual(field(parse(modified.body), "lastModified"), sets)
      ) {
        addIssue(modified.target, "body", "lastModified не как в манифесте R2");
      }
    }
    done(modified.target);

    const changes = await check200(
      "changelog",
      `changelog?prefix=${set}`,
      API_TYPES.json,
      atCatalog,
    );
    if (changes.body !== undefined) {
      changes.target.checked.push("body");
      const releases = field(parse(changes.body), "releases");
      if (!Array.isArray(releases) || releases.length === 0) {
        addIssue(changes.target, "body", "выпусков нет");
      } else {
        if (releases.some((r) => field(r, "prefix") !== set)) {
          addIssue(changes.target, "body", `есть выпуски не «${set}»`);
        }
        if (field(releases[0], "version") !== setVersion) {
          addIssue(
            changes.target,
            "body",
            `свежий выпуск — не версия ${setVersion} из манифеста`,
          );
        }
        const dates = releases.map((r) => Date.parse(String(field(r, "date"))));
        if (dates.some((d, i) => i > 0 && d >= (dates[i - 1] as number))) {
          addIssue(changes.target, "body", "выпуски не от свежих к старым");
        }
      }
    }
    done(changes.target);

    done(
      await check404(
        "missing-collection",
        `collection?prefix=${API_CHECK_ABSENT}`,
        "set_not_found",
      ),
    );
    done(
      await check404("collection-prefix", "collection", "prefix_required", 400),
    );
  }

  // Манифест R2: версия набора-образца.
  let manifestText = options.manifest;
  if (manifestText === undefined) {
    const res = await fromStatic(MANIFEST_FILE);
    if (!("error" in res) && res.status === 200) manifestText = utf8(res.body);
    else {
      stop.push(
        `манифест https://${STATIC_HOST}/${MANIFEST_FILE} не прочитан: ${"error" in res ? res.error : `ответ ${res.status}`}`,
      );
    }
  }
  if (manifestText !== undefined) {
    const parsed = manifestSchema.safeParse(parse(Buffer.from(manifestText)));
    const entry = parsed.success
      ? Object.hasOwn(parsed.data.sets, set)
        ? parsed.data.sets[set]
        : undefined
      : undefined;
    if (entry === undefined) {
      stop.push(`в манифесте R2 нет набора «${set}» или он не по схеме`);
    } else {
      version = entry.version;
      lastModified = entry.lastModified;
    }
    if (parsed.success) {
      catalog = parsed.data.catalog;
      sets = Object.fromEntries(
        Object.entries(parsed.data.sets).map(([id, e]) => [id, e.lastModified]),
      );
    }
  }
  if (version === undefined) {
    done(await checkRedirect());
    return report();
  }

  // Ожидание: функция отдаёт версию из манифеста (и, после выкладки, нужную сборку).
  const batchPath = `${set}.json?icons=${API_CHECK_ICON},${API_CHECK_ALIAS},${API_CHECK_MISSING}`;
  const waitMs = options.waitMs ?? API_WAIT_MS;
  const step = options.waitStepMs ?? API_WAIT_STEP_MS;
  const waitStart = now();
  for (;;) {
    const res = await api(batchPath);
    let last: string;
    if ("error" in res) {
      last = res.error;
    } else {
      const v = res.headers.get("x-iconavo-version");
      const b = res.headers.get("x-iconavo-build");
      if (
        v === version &&
        (options.expectBuild === undefined || b === options.expectBuild)
      ) {
        build = b ?? undefined;
        break;
      }
      last = `ответ ${res.status}, X-Iconavo-Version ${shown(v)}, X-Iconavo-Build ${shown(b)}`;
    }
    if (now() - waitStart + step > waitMs) {
      waitedMs = now() - waitStart;
      stop.push(
        `API не отдал версию ${set} ${version}${options.expectBuild === undefined ? "" : ` сборкой ${options.expectBuild}`} за ${Math.round(waitMs / 1000)} с; последний ответ — ${last}`,
      );
      done(await checkRedirect());
      return report();
    }
    options.log?.(`жду версию ${version}: ${last}`);
    await sleep(step);
  }
  waitedMs = now() - waitStart;

  // Пачка: тело — как файлы статики той же версии.
  const batch = await check200("batch", batchPath, API_TYPES.json);
  if (batch.body !== undefined) {
    batch.target.checked.push("body");
    const base = `${VERSIONS_DIR}/${version}/${set}`;
    const [iconRes, aliasRes] = [
      await fromStatic(`${base}/${API_CHECK_ICON}.json`),
      await fromStatic(`${base}/${API_CHECK_ALIAS}.json`),
    ];
    if ("error" in iconRes || "error" in aliasRes) {
      addIssue(batch.target, "body", "файлы статики не прочитаны");
    } else {
      const data = parse(batch.body);
      const icon = parse(iconRes.body);
      const alias = parse(aliasRes.body);
      const same = (what: string, got: unknown, want: unknown) => {
        if (!isDeepStrictEqual(got, want) || want === undefined) {
          addIssue(batch.target, "body", `${what} не как на статике`);
        }
      };
      const icons = field(data, "icons");
      same(
        `иконка ${API_CHECK_ICON}`,
        field(icons, API_CHECK_ICON),
        field(field(icon, "icons"), API_CHECK_ICON),
      );
      same(
        `иконка ${API_CHECK_ALIAS_PARENT}`,
        field(icons, API_CHECK_ALIAS_PARENT),
        field(field(alias, "icons"), API_CHECK_ALIAS_PARENT),
      );
      same(
        `алиас ${API_CHECK_ALIAS}`,
        field(field(data, "aliases"), API_CHECK_ALIAS),
        field(field(alias, "aliases"), API_CHECK_ALIAS),
      );
      same("ширина", field(data, "width"), field(icon, "width"));
      same("высота", field(data, "height"), field(icon, "height"));
      if (field(data, "prefix") !== set) {
        addIssue(batch.target, "body", `prefix не «${set}»`);
      }
      if (field(data, "lastModified") !== lastModified) {
        addIssue(batch.target, "body", "lastModified не как в манифесте");
      }
      if (!isDeepStrictEqual(field(data, "not_found"), [API_CHECK_MISSING])) {
        addIssue(
          batch.target,
          "body",
          `в not_found не только «${API_CHECK_MISSING}»`,
        );
      }
    }
  }
  done(batch.target);

  // Те же имена в другом порядке: из кэша и побайтно тот же ответ.
  const order = await check200(
    "batch-order",
    `${set}.json?icons=${API_CHECK_MISSING},${API_CHECK_ALIAS},${API_CHECK_ICON}`,
    API_TYPES.json,
    { hit: true },
  );
  if (order.body !== undefined && batch.body !== undefined) {
    order.target.checked.push("body");
    if (Buffer.compare(order.body, batch.body) !== 0) {
      addIssue(order.target, "body", "другой порядок имён — другой ответ");
    }
  }
  done(order.target);

  // SVG без параметров — побайтно файл статики.
  const svg = await check200(
    "svg",
    `${set}/${API_CHECK_ICON}.svg`,
    API_TYPES.svg,
    {
      csp: true,
    },
  );
  if (svg.body !== undefined) {
    svg.target.checked.push("body");
    const file = await fromStatic(
      `${VERSIONS_DIR}/${version}/${set}/${API_CHECK_ICON}.svg`,
    );
    if ("error" in file || file.status !== 200) {
      addIssue(svg.target, "body", "файл статики не прочитан");
    } else if (Buffer.compare(svg.body, file.body) !== 0) {
      addIssue(svg.target, "body", "SVG без параметров не равен файлу статики");
    }
  }
  done(svg.target);

  const params = await check200(
    "svg-params",
    `${set}/${API_CHECK_ICON}.svg?color=red&height=64`,
    API_TYPES.svg,
    { csp: true },
  );
  if (params.body !== undefined) {
    params.target.checked.push("body");
    const text = utf8(params.body);
    if (!text.includes('width="64" height="64"')) {
      addIssue(params.target, "body", "размер не 64×64");
    }
    if (!text.includes('"red"') || text.includes("currentColor")) {
      addIssue(params.target, "body", "цвет не заменён на red");
    }
  }
  done(params.target);

  const transform = await check200(
    "svg-transform",
    `${set}/${API_CHECK_ICON}.svg?rotate=90deg&flip=horizontal`,
    API_TYPES.svg,
    { csp: true },
  );
  if (transform.body !== undefined) {
    transform.target.checked.push("body");
    if (!utf8(transform.body).includes(API_CHECK_TRANSFORM)) {
      addIssue(transform.target, "body", `нет ${API_CHECK_TRANSFORM}`);
    }
  }
  done(transform.target);

  const css = await check200(
    "css",
    `${set}.css?icons=${API_CHECK_ICON},${API_CHECK_ALIAS}`,
    API_TYPES.css,
  );
  if (css.body !== undefined) {
    css.target.checked.push("body");
    const text = utf8(css.body);
    for (const want of [
      `.icon--${set} {`,
      `.icon--${set}--${API_CHECK_ICON} {`,
      `.icon--${set}--${API_CHECK_ALIAS} {`,
      "mask-image: var(--svg);",
    ]) {
      if (!text.includes(want)) addIssue(css.target, "body", `нет «${want}»`);
    }
  }
  done(css.target);

  if (catalog === undefined) {
    notes.push(
      "каталог наборов не проверялся: в манифесте R2 ещё нет поля catalog — его выложит «Выкладка» (pnpm cdn upload)",
    );
  } else if (await waitCatalog(catalog)) {
    await checkCatalog(catalog, version);
  }

  done(
    await check404(
      "missing-set",
      `${API_CHECK_ABSENT}.json?icons=${API_CHECK_ICON}`,
      "set_not_found",
    ),
  );
  done(
    await check404(
      "missing-icon",
      `${set}/${API_CHECK_ABSENT}.svg`,
      "icon_not_found",
    ),
  );
  done(await checkRedirect());
  return report();
}
