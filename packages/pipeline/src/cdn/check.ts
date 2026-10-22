// Проверка раздачи по живым адресам (ADR-0023, шаг 3 фазы 2): манифест, файл сумм и иконка-образец
// текущей версии (.json и .svg), а ещё несуществующее имя — его 404 должен нести CORS, иначе чужой
// сайт увидит не «иконки нет», а сбой сети. Content-Type и Cache-Control хранятся у объектов R2
// (выгрузка, ADR-0022), кэш на CDN, CORS и заголовки защиты добавляют правила Cloudflare, сжатие
// Cloudflare делает сам. К файлу — два запроса: с Origin и «br, gzip», как у чужого сайта, и без
// Origin только с gzip — так видно второе сжатие и то, что CORS не зависит от Origin (копия в кэше
// CDN одна на всех). Ключи не нужны: адреса открытые. Повторы — как у выгрузки (s3.ts).

import type { z } from "zod";
import { retryable, retryDelay } from "../embed/client.js";
import type { FetchFn } from "../sources/npm.js";
import {
  CACHE_IMMUTABLE,
  CACHE_MANIFEST,
  CDN_HOST,
  CHECK_ICON,
  CHECK_MAX_ATTEMPTS,
  CHECK_MISSING,
  CHECK_ORIGIN,
  CHECK_SET,
  CHECK_TIMEOUT_MS,
  CHECKSUMS_SUFFIX,
  CORS_ALLOW_ORIGIN,
  EDGE_CACHED,
  EDGE_DIRECT,
  MANIFEST_FILE,
  SECURITY_HEADERS,
  SVG_CSP,
  VERSIONS_DIR,
} from "./config.js";
import { checksumsSchema, manifestSchema } from "./files.js";
import { sha256Hex } from "./sigv4.js";
import { contentTypeOf } from "./upload.js";

/** Группы проверок — колонки таблицы, в этом порядке. */
export const CHECK_GROUPS = [
  "status",
  "type",
  "cache",
  "edge",
  "cors",
  "security",
  "encoding",
  "body",
] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

/** Вид адреса — от него зависят ожидания. */
export type CheckKind = "manifest" | "checksums" | "json" | "svg" | "missing";

export interface CheckIssue {
  group: CheckGroup;
  message: string;
}

export interface TargetReport {
  kind: CheckKind;
  /** Путь от корня хоста: manifest.json, v/{версия}/… */
  path: string;
  /** Код ответа на первый запрос; ответа не было — undefined. */
  status?: number;
  /** Проверенные группы; остальные в таблице — «—». */
  checked: CheckGroup[];
  issues: CheckIssue[];
}

export interface CheckReport {
  host: string;
  set: string;
  icon: string;
  /** Версия набора-образца из манифеста; манифест не прочитан — undefined. */
  version?: string;
  targets: TargetReport[];
  /** Почему файлы версии не проверялись. */
  stop: string[];
  /** HTTP-запросов вместе с повторами. */
  requests: number;
  ms: number;
}

export interface CheckOptions {
  /** Хост раздачи; на шаге 4 — и второй (ADR-0025). */
  host?: string;
  /** Образец: набор и имя иконки. */
  set?: string;
  icon?: string;
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Строка о каждом проверенном адресе: с медленного соединения проверка идёт до минуты. */
  log?: (line: string) => void;
}

export const checkFailed = (r: CheckReport) =>
  r.stop.length > 0 || r.targets.some((t) => t.issues.length > 0);

/** Что ждём от файла раздачи. */
interface FileExpectation {
  type: string;
  cache: string;
  /** Файл версии кэшируется на CDN, манифест — нет: его читают прямо из R2 (ADR-0023). */
  edge: "cached" | "direct";
  csp: boolean;
}

function fileExpectation(
  kind: Exclude<CheckKind, "missing">,
  path: string,
): FileExpectation {
  const manifest = kind === "manifest";
  return {
    type: contentTypeOf(path),
    cache: manifest ? CACHE_MANIFEST : CACHE_IMMUTABLE,
    edge: manifest ? "direct" : "cached",
    csp: kind === "svg",
  };
}

interface Fetched {
  status: number;
  headers: Headers;
  body: Uint8Array;
}

const shown = (value: string | null) => (value === null ? "нет" : `«${value}»`);

/** Имя заголовка как в DevTools: x-content-type-options → X-Content-Type-Options. */
const label = (name: string) =>
  name.replace(
    /(^|-)([a-z])/g,
    (_match, dash: string, letter: string) => `${dash}${letter.toUpperCase()}`,
  );

/** Заголовок не с тем значением — что пришло и что ждём; совпал — undefined. */
function mismatch(
  headers: Headers,
  name: string,
  want: string,
  suffix = "",
): string | undefined {
  const got = headers.get(name);
  return got === want
    ? undefined
    : `${label(name)}: ${shown(got)} вместо «${want}»${suffix}`;
}

function addIssue(
  target: TargetReport,
  group: CheckGroup,
  message: string | undefined,
) {
  if (message !== undefined) target.issues.push({ group, message });
}

/** JSON по схеме: данные или почему не подошёл. */
function parseJson<T>(
  body: Uint8Array,
  schema: z.ZodType<T>,
): { data: T } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    return { error: "не JSON" };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { data: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.map(String).join(".") || "корень";
  return {
    error: `не по схеме${issue === undefined ? "" : ` (${where}: ${issue.message})`}`,
  };
}

export async function checkCdn(
  options: CheckOptions = {},
): Promise<CheckReport> {
  const host = options.host ?? CDN_HOST;
  const set = options.set ?? CHECK_SET;
  const icon = options.icon ?? CHECK_ICON;
  const fetchFn = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? CHECK_MAX_ATTEMPTS;
  const started = now();
  let requests = 0;

  /** GET с повторами; после последней попытки временный отказ — обычный ответ с неверным кодом. */
  async function get(
    path: string,
    headers: Record<string, string>,
  ): Promise<Fetched | { error: string }> {
    for (let attempt = 1; ; attempt++) {
      let wait: number | undefined;
      try {
        requests++;
        // Перенаправление — тоже неверный ответ; тело читается под тем же ожиданием.
        const res = await fetchFn(`https://${host}/${path}`, {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = new Uint8Array(await res.arrayBuffer());
        if (!retryable(res.status) || attempt >= maxAttempts) {
          return { status: res.status, headers: res.headers, body };
        }
        wait = retryDelay(res.headers.get("retry-after"), attempt);
      } catch (e) {
        const name = (e as Error).name;
        let reason: string;
        if (name === "TimeoutError" || name === "AbortError") {
          reason = `нет ответа за ${Math.round(timeoutMs / 1000)} с`;
        } else if (
          e instanceof TypeError &&
          (e.message === "fetch failed" || "cause" in e)
        ) {
          // Так fetch в Node сообщает о сбое соединения; причина — в cause.
          const cause = (e as { cause?: { code?: string } }).cause?.code;
          reason = `сбой сети${cause ? ` (${cause})` : ""}: ${e.message}`;
        } else {
          return { error: (e as Error).message };
        }
        if (attempt >= maxAttempts) {
          return {
            error: `${reason} — не получилось за ${maxAttempts} попыток`,
          };
        }
      }
      await sleep(wait ?? retryDelay(null, attempt));
    }
  }

  /** Заголовки адреса; тело — только у файла раздачи с ответом 200. */
  async function checkTarget(
    kind: CheckKind,
    path: string,
  ): Promise<{ target: TargetReport; body?: Uint8Array }> {
    const target: TargetReport = {
      kind,
      path,
      checked: ["status"],
      issues: [],
    };
    const first = await get(path, {
      origin: CHECK_ORIGIN,
      "accept-encoding": "br, gzip",
    });
    if ("error" in first) {
      addIssue(target, "status", first.error);
      return { target };
    }
    const wantStatus = kind === "missing" ? 404 : 200;
    const file = kind === "missing" ? undefined : fileExpectation(kind, path);
    target.status = first.status;
    target.checked.push("cors", "security");
    if (first.status !== wantStatus) {
      addIssue(target, "status", `ответ ${first.status} вместо ${wantStatus}`);
    }
    addIssue(
      target,
      "cors",
      mismatch(first.headers, "access-control-allow-origin", CORS_ALLOW_ORIGIN),
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      addIssue(target, "security", mismatch(first.headers, name, value));
    }
    if (file?.csp) {
      addIssue(
        target,
        "security",
        mismatch(first.headers, "content-security-policy", SVG_CSP),
      );
    }
    // У 404 и неверного ответа тип, кэш и сжатие не проверяются: это не файл раздачи.
    if (file === undefined || first.status !== 200) return { target };
    target.checked.push("type", "cache", "edge", "encoding");
    addIssue(
      target,
      "type",
      mismatch(first.headers, "content-type", file.type),
    );
    addIssue(
      target,
      "cache",
      mismatch(first.headers, "cache-control", file.cache),
    );
    const edge = first.headers.get("cf-cache-status");
    if (file.edge === "cached" && !EDGE_CACHED.includes(edge ?? "")) {
      addIssue(
        target,
        "edge",
        `файл не кэшируется на CDN: cf-cache-status ${shown(edge)} вместо HIT, MISS или похожего`,
      );
    }
    if (file.edge === "direct" && !EDGE_DIRECT.includes(edge ?? "")) {
      addIssue(
        target,
        "edge",
        `манифест хранится в кэше CDN: cf-cache-status ${shown(edge)} вместо DYNAMIC или BYPASS`,
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
    // Второй запрос — без Origin и только gzip.
    const second = await get(path, { "accept-encoding": "gzip" });
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
      // Манифест между двумя запросами может смениться выкладкой; файлы версии — нет.
      if (
        kind !== "manifest" &&
        Buffer.compare(first.body, second.body) !== 0
      ) {
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

  const targets: TargetReport[] = [];
  const stop: string[] = [];
  const done = (target: TargetReport) => {
    targets.push(target);
    options.log?.(
      `${target.path} — ${target.issues.length === 0 ? "ок" : "не так"}`,
    );
  };
  const report = (version?: string): CheckReport => ({
    host,
    set,
    icon,
    version,
    targets,
    stop,
    requests,
    ms: now() - started,
  });

  // Манифест даёт версию набора-образца.
  const manifest = await checkTarget("manifest", MANIFEST_FILE);
  let version: string | undefined;
  if (manifest.body !== undefined) {
    manifest.target.checked.push("body");
    const parsed = parseJson(manifest.body, manifestSchema);
    if ("error" in parsed) {
      addIssue(manifest.target, "body", `манифест ${parsed.error}`);
    } else if (!Object.hasOwn(parsed.data.sets, set)) {
      addIssue(manifest.target, "body", `в манифесте нет набора «${set}»`);
    } else {
      version = parsed.data.sets[set]?.version;
    }
  }
  done(manifest.target);
  if (version === undefined) {
    stop.push(
      `версия набора «${set}» неизвестна — файлы версии не проверялись`,
    );
    return report();
  }

  const base = `${VERSIONS_DIR}/${version}`;
  const sums = await checkTarget(
    "checksums",
    `${base}/${set}${CHECKSUMS_SUFFIX}`,
  );
  let files: Record<string, string> | undefined;
  if (sums.body !== undefined) {
    sums.target.checked.push("body");
    const parsed = parseJson(sums.body, checksumsSchema);
    if ("error" in parsed) {
      addIssue(sums.target, "body", `файл сумм ${parsed.error}`);
    } else if (parsed.data.prefix !== set || parsed.data.version !== version) {
      addIssue(
        sums.target,
        "body",
        `файл сумм набора «${parsed.data.prefix}» версии «${parsed.data.version}» вместо «${set}» «${version}»`,
      );
    } else {
      files = parsed.data.files;
    }
  }
  done(sums.target);

  for (const ext of ["json", "svg"] as const) {
    const name = `${set}/${icon}.${ext}`;
    const { target, body } = await checkTarget(ext, `${base}/${name}`);
    // Без файла сумм сверять не с чем: его проблема уже в отчёте.
    if (body !== undefined && files !== undefined) {
      target.checked.push("body");
      const want = files[name];
      if (want === undefined) {
        addIssue(target, "body", `в файле сумм нет «${name}»`);
      } else if (sha256Hex(body) !== want) {
        addIssue(target, "body", "содержимое не совпадает с файлом сумм");
      }
    }
    done(target);
  }

  const missing = await checkTarget(
    "missing",
    `${base}/${set}/${CHECK_MISSING}.json`,
  );
  done(missing.target);
  return report(version);
}
