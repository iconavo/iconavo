// Проверка раздачи по живым адресам (ADR-0023, шаги 3 и 4 фазы 2): манифест, файл сумм и иконка-
// образец текущей версии (.json и .svg), а ещё несуществующее имя — его 404 должен нести CORS, иначе
// чужой сайт увидит не «иконки нет», а сбой сети. На cdn.iconavo.dev Content-Type и Cache-Control
// хранятся у объектов R2 (выгрузка, ADR-0022), кэш на CDN, CORS и заголовки защиты добавляют правила
// Cloudflare; на cdn2.iconavo.dev Cache-Control, CORS и защиту ставят правила зоны CDN Bunny
// (ADR-0025). Сжатие оба CDN делают сами. К файлу — два запроса: с Origin и «br, gzip», как у чужого
// сайта, и без Origin только с gzip — так видно второе сжатие и то, что CORS не зависит от Origin
// (копия в кэше CDN одна на всех). Server показывает, что ответ пришёл от CDN этого хоста: запись
// cdn2 через прокси Cloudflare лишила бы второй хост независимости. Последний адрес — манифест по
// http://: ждём постоянный переход на тот же адрес по https (Always Use HTTPS у Cloudflare, Force
// SSL у Bunny). Браузеры и так открывают .dev только по https, переход нужен программам. Ключи не
// нужны: адреса открытые. Повторы — как у выгрузки (storage.ts).

import type { z } from "zod";
import { retryable, retryDelay } from "../embed/client.js";
import type { FetchFn } from "../sources/npm.js";
import {
  CACHE_IMMUTABLE,
  CACHE_MANIFEST,
  type CdnHost,
  type CdnProvider,
  CHECK_ICON,
  CHECK_MAX_ATTEMPTS,
  CHECK_MISSING,
  CHECK_ORIGIN,
  CHECK_SET,
  CHECK_TIMEOUT_MS,
  CHECKSUMS_SUFFIX,
  CORS_ALLOW_ORIGIN,
  HTTPS_REDIRECTS,
  MANIFEST_FILE,
  R2_CDN,
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
  "https",
  "type",
  "cache",
  "edge",
  "cors",
  "security",
  "encoding",
  "body",
] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

/** Вид адреса — от него зависят ожидания; redirect — манифест по http://. */
export type CheckKind =
  | "manifest"
  | "checksums"
  | "json"
  | "svg"
  | "missing"
  | "redirect";

export interface CheckIssue {
  group: CheckGroup;
  message: string;
}

export interface TargetReport {
  kind: CheckKind;
  /** Путь от корня хоста: manifest.json, v/{версия}/…; у перехода — «manifest.json по http». */
  path: string;
  /** Код ответа на первый запрос; ответа не было — undefined. */
  status?: number;
  /** Проверенные группы; остальные в таблице — «—». */
  checked: CheckGroup[];
  issues: CheckIssue[];
}

export interface CheckReport {
  host: string;
  provider: CdnProvider;
  set: string;
  icon: string;
  /** Версия набора-образца из манифеста; манифест не прочитан — undefined. */
  version?: string;
  /** Текст манифеста, если он по схеме, — для сравнения хостов между собой. */
  manifest?: string;
  targets: TargetReport[];
  /** Почему файлы версии не проверялись. */
  stop: string[];
  /** HTTP-запросов вместе с повторами. */
  requests: number;
  ms: number;
}

export interface CheckOptions {
  /** Хост раздачи и как его CDN показывает кэш; по умолчанию основной (R2 и Cloudflare). */
  target?: CdnHost;
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
  kind: Exclude<CheckKind, "missing" | "redirect">,
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

export interface Fetched {
  status: number;
  headers: Headers;
  body: Uint8Array;
}

/** Как ходить по живым адресам: те же повторы у статики и у edge API. */
export interface LiveGetOptions {
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  maxAttempts: number;
  /** Каждая попытка — в счётчик запросов отчёта. */
  onRequest: () => void;
}

/** GET с повторами; после последней попытки временный отказ — обычный ответ с неверным кодом. */
export async function liveGet(
  url: string,
  headers: Record<string, string>,
  o: LiveGetOptions,
): Promise<Fetched | { error: string }> {
  for (let attempt = 1; ; attempt++) {
    let wait: number | undefined;
    try {
      o.onRequest();
      // Перенаправление — тоже неверный ответ; тело читается под тем же ожиданием.
      const res = await o.fetch(url, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      const body = new Uint8Array(await res.arrayBuffer());
      if (!retryable(res.status) || attempt >= o.maxAttempts) {
        return { status: res.status, headers: res.headers, body };
      }
      wait = retryDelay(res.headers.get("retry-after"), attempt);
    } catch (e) {
      const name = (e as Error).name;
      let reason: string;
      if (name === "TimeoutError" || name === "AbortError") {
        reason = `нет ответа за ${Math.round(o.timeoutMs / 1000)} с`;
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
      if (attempt >= o.maxAttempts) {
        return {
          error: `${reason} — не получилось за ${o.maxAttempts} попыток`,
        };
      }
    }
    await o.sleep(wait ?? retryDelay(null, attempt));
  }
}

export const shown = (value: string | null) =>
  value === null ? "нет" : `«${value}»`;

/** Имя заголовка как в DevTools: x-content-type-options → X-Content-Type-Options. */
const label = (name: string) =>
  name.replace(
    /(^|-)([a-z])/g,
    (_match, dash: string, letter: string) => `${dash}${letter.toUpperCase()}`,
  );

/** Заголовок не с тем значением — что пришло и что ждём; совпал — undefined. */
export function mismatch(
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

export function addIssue(
  target: Pick<TargetReport, "issues">,
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
  const cdn = options.target ?? R2_CDN;
  const { host } = cdn;
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
  const live: LiveGetOptions = {
    fetch: fetchFn,
    sleep,
    timeoutMs,
    maxAttempts,
    onRequest: () => {
      requests++;
    },
  };
  const get = (
    path: string,
    headers: Record<string, string>,
    scheme: "https" | "http" = "https",
  ) => liveGet(`${scheme}://${host}/${path}`, headers, live);

  /** Манифест по http://: постоянный переход на тот же адрес по https. */
  async function checkRedirect(): Promise<TargetReport> {
    const target: TargetReport = {
      kind: "redirect",
      path: `${MANIFEST_FILE} по http`,
      checked: ["status"],
      issues: [],
    };
    const res = await get(MANIFEST_FILE, {}, "http");
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
          `https://${host}/${MANIFEST_FILE}`,
          " — переход не на тот же адрес по https",
        ),
      );
    }
    return target;
  }

  /** Заголовки адреса; тело — только у файла раздачи с ответом 200. */
  async function checkTarget(
    kind: Exclude<CheckKind, "redirect">,
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
    const server = first.headers.get("server");
    if (!server?.toLowerCase().startsWith(cdn.server.toLowerCase())) {
      addIssue(
        target,
        "edge",
        `ответ пришёл не от ${cdn.server}: Server ${shown(server)}`,
      );
    }
    const edge = first.headers.get(cdn.cacheHeader);
    if (file.edge === "cached" && !cdn.edgeCached.includes(edge ?? "")) {
      addIssue(
        target,
        "edge",
        `файл не кэшируется на CDN: ${cdn.cacheHeader} ${shown(edge)} вместо ${cdn.edgeCached.slice(0, 2).join(", ")} или похожего`,
      );
    }
    if (file.edge === "direct" && !cdn.edgeDirect.includes(edge ?? "")) {
      addIssue(
        target,
        "edge",
        `манифест хранится в кэше CDN: ${cdn.cacheHeader} ${shown(edge)} вместо ${cdn.edgeDirect.join(" или ")}`,
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
      // Манифест не должен оседать в кэше CDN и после первого запроса.
      const again = second.headers.get(cdn.cacheHeader);
      if (
        file.edge === "direct" &&
        cdn.edgeDirect.includes(edge ?? "") &&
        !cdn.edgeDirect.includes(again ?? "")
      ) {
        addIssue(
          target,
          "edge",
          `манифест хранится в кэше CDN: ${cdn.cacheHeader} ${shown(again)} вместо ${cdn.edgeDirect.join(" или ")} на втором запросе`,
        );
      }
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
  let manifestText: string | undefined;
  const report = (version?: string): CheckReport => ({
    host,
    provider: cdn.provider,
    set,
    icon,
    version,
    manifest: manifestText,
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
    } else {
      manifestText = Buffer.from(manifest.body).toString("utf8");
      if (!Object.hasOwn(parsed.data.sets, set)) {
        addIssue(manifest.target, "body", `в манифесте нет набора «${set}»`);
      } else {
        version = parsed.data.sets[set]?.version;
      }
    }
  }
  done(manifest.target);
  if (version === undefined) {
    stop.push(
      `версия набора «${set}» неизвестна — файлы версии не проверялись`,
    );
    // Переход на https от версии не зависит — его видно и без манифеста.
    done(await checkRedirect());
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
  done(await checkRedirect());
  return report(version);
}

/**
 * Хосты между собой: манифесты побайтно одинаковые — иначе ядро возьмёт версию у одного хоста, а у
 * другого её может не быть (ADR-0025). Хост без прочитанного манифеста не сравнивается: его
 * проблема уже в его отчёте. Пусто — расхождений нет.
 */
export function compareHostManifests(
  reports: readonly CheckReport[],
): string[] {
  const read = reports.filter(
    (r): r is CheckReport & { manifest: string } => r.manifest !== undefined,
  );
  const [first, ...rest] = read;
  if (first === undefined) return [];
  const versions = (text: string) =>
    manifestSchema.parse(JSON.parse(text)).sets;
  const base = versions(first.manifest);
  const issues: string[] = [];
  for (const r of rest) {
    if (r.manifest === first.manifest) continue;
    const other = versions(r.manifest);
    const ids = [...new Set([...Object.keys(base), ...Object.keys(other)])]
      .sort()
      .filter((id) => base[id]?.version !== other[id]?.version);
    const diff =
      ids.length === 0
        ? "версии наборов те же, отличаются даты или запись"
        : ids
            .map(
              (id) =>
                `${id} — ${base[id]?.version ?? "нет"} и ${other[id]?.version ?? "нет"}`,
            )
            .join("; ");
    issues.push(
      `манифест https://${r.host}/${MANIFEST_FILE} не тот, что на https://${first.host}/${MANIFEST_FILE}: ${diff}`,
    );
  }
  return issues;
}
