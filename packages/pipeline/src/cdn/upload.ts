// Выгрузка раздачи на хосты (шаги 2 и 4 фазы 2, ADR-0022, ADR-0025): dist-cdn/ → хранилище каждого
// хоста, только недостающие файлы. Хосты идут по очереди — R2, затем Bunny. Версии неизменяемы,
// поэтому в v/ ничего не перезаписывается: расхождение с хранилищем — «СТОП», а не правка. Порядок
// в наборе: файлы → файл сумм последним, он признак целой папки → сверка по списку объектов: размер и
// SHA-256 (Bunny) или ETag = MD5 (R2) каждого файла версии; целостность при записи сверяет сам сервер.
// Манифесты — в самом конце, когда файлы версий есть на всех хостах, второй хост — последним, и
// только где он отличается: ядро берёт версию из манифеста одного хоста, а файл может попросить у
// другого (ADR-0030). «СТОП» на хосте — дальше ничего не пишется: следующий хост не выгружается,
// манифесты не пишутся нигде, иначе хосты разойдутся. Показ (--dry-run) и сверка сравнивают все
// хосты. Ничего не удаляется. Без ключей не работает даже показ: списки хранилищ без ключа не отдаются.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatBytes } from "../sources/report.js";
import { pool } from "../util/pool.js";
import {
  CACHE_IMMUTABLE,
  CACHE_MANIFEST,
  CHECKSUMS_SUFFIX,
  CONTENT_TYPES,
  MANIFEST_FILE,
  MISMATCH_LIMIT,
  PROGRESS_EVERY,
  UPLOAD_CONCURRENCY,
  VERSIONS_DIR,
} from "./config.js";
import { checksumsSchema, type Manifest, manifestSchema } from "./files.js";
import { md5Hex } from "./s3.js";
import { sha256Hex } from "./sigv4.js";
import {
  type RemoteObject,
  type StorageClient,
  storageErrorScope,
} from "./storage.js";
import { checksumsPath, setDir } from "./write.js";

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const utf8 = (data: Uint8Array) => Buffer.from(data).toString("utf8");
const REBUILD = "запустите pnpm cdn build";

/** Файл версии с диска, готовый к выгрузке. */
export interface LocalFile {
  /** Ключ в хранилище: v/{версия}/{набор}/{имя}.json или v/{версия}/{набор}.checksums.json. */
  key: string;
  data: Uint8Array;
  md5: string;
  sha256: string;
  contentType: string;
}

export type UploadStatus = "uploaded" | "unchanged" | "planned" | "stopped";

export interface SetUploadReport {
  id: string;
  version: string;
  /** Файлов версии вместе с файлом сумм. */
  files: number;
  bytes: number;
  /** Уже лежали в хранилище и совпали. */
  present: number;
  /** Недоставало в хранилище. */
  missing: number;
  /** Выгружено за этот прогон. */
  uploaded: number;
  uploadedBytes: number;
  ms: number;
  status: UploadStatus;
  stop: string[];
  /** Пути иконки для ссылок в отчёте относительно v/{версия}/: {набор}/{имя}.json и .svg. */
  samples: string[];
}

export type ManifestStatus = "written" | "unchanged" | "planned" | "skipped";

/** Хост выгрузки: адрес, хранилище за ним и клиент этого хранилища. */
export interface UploadHost {
  host: string;
  storage: string;
  client: StorageClient;
}

export interface HostUploadReport {
  host: string;
  storage: string;
  sets: SetUploadReport[];
  /** Манифест в хранилище до выгрузки; нет — манифеста не было или он не читался. */
  remoteManifest?: string;
  manifestStatus: ManifestStatus;
  /** Почему манифест не записан. */
  manifestNote?: string;
  /** «СТОП» всего хоста: ключи не подошли, хост не выгружался, манифест не записался. */
  stop: string[];
  ms: number;
}

export interface UploadReport {
  dryRun: boolean;
  /** Локальный манифест; нет — не прочитан. */
  manifest?: string;
  hosts: HostUploadReport[];
  /** «СТОП» всего прогона: локальный манифест не читается. */
  stop: string[];
  ms: number;
}

export interface UploadOptions {
  outDir: string;
  /** Хосты в порядке выгрузки: основной, затем второй (ADR-0025). */
  hosts: readonly UploadHost[];
  dryRun?: boolean;
  concurrency?: number;
  log?: (line: string) => void;
  now?: () => number;
}

export const hostStop = (h: HostUploadReport) =>
  h.stop.length > 0 || h.sets.some((s) => s.stop.length > 0);

export const uploadStop = (r: UploadReport) =>
  r.stop.length > 0 || r.hosts.some(hostStop);

/** Сверка не сошлась: «СТОП» или хоть один файл или манифест пришлось бы выгрузить. */
export const verifyFailed = (r: UploadReport) =>
  uploadStop(r) ||
  r.hosts.some(
    (h) =>
      h.manifestStatus === "planned" ||
      h.sets.some((s) => s.status === "planned"),
  );

/** Тип содержимого по расширению: json и svg — другого в раздаче нет. */
export function contentTypeOf(path: string): string {
  const type = CONTENT_TYPES[path.slice(path.lastIndexOf(".") + 1)];
  if (type === undefined) throw new Error(`неизвестный тип файла «${path}»`);
  return type;
}

/**
 * Файлы версии набора с диска по файлу сумм: каждый сверяется с SHA-256, лишние файлы в папке —
 * ошибка. Файл сумм — последним: его и выгружают последним.
 */
export async function readSetFiles(
  outDir: string,
  id: string,
  version: string,
  concurrency = UPLOAD_CONCURRENCY,
): Promise<LocalFile[]> {
  const sumsName = `${VERSIONS_DIR}/${version}/${id}${CHECKSUMS_SUFFIX}`;
  let sumsBytes: Uint8Array;
  try {
    sumsBytes = new Uint8Array(
      await readFile(checksumsPath(outDir, id, version)),
    );
  } catch {
    throw new Error(`нет файла сумм ${sumsName} — ${REBUILD}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(utf8(sumsBytes));
  } catch {
    json = undefined;
  }
  const parsed = checksumsSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`файл сумм ${sumsName} не по схеме — ${REBUILD}`);
  }
  const sums = parsed.data;
  if (sums.prefix !== id || sums.version !== version) {
    throw new Error(
      `файл сумм ${sumsName} — от набора «${sums.prefix}» версии ${sums.version}, а не «${id}» ${version} — ${REBUILD}`,
    );
  }
  const paths = Object.keys(sums.files).sort(order);
  const stray = paths.find(
    (p) => !p.startsWith(`${id}/`) || p.split("/").length !== 2,
  );
  if (stray !== undefined) {
    throw new Error(
      `в файле сумм ${sumsName} путь не из папки набора: ${stray} — ${REBUILD}`,
    );
  }
  let entries: string[];
  try {
    entries = await readdir(setDir(outDir, id, version));
  } catch {
    throw new Error(`нет папки ${VERSIONS_DIR}/${version}/${id}/ — ${REBUILD}`);
  }
  const expected = new Set(paths.map((p) => p.slice(id.length + 1)));
  const extra = entries.filter((e) => !expected.has(e)).sort(order);
  if (extra.length > 0) {
    throw new Error(
      `в папке ${VERSIONS_DIR}/${version}/${id}/ лишние файлы (${extra.length}): ${extra.slice(0, MISMATCH_LIMIT).join(", ")} — ${REBUILD}`,
    );
  }
  const base = `${VERSIONS_DIR}/${version}/`;
  const files: (LocalFile | undefined)[] = paths.map(() => undefined);
  const problems: string[] = [];
  await pool(
    paths.map((path, i) => ({ path, i })),
    concurrency,
    async ({ path, i }) => {
      if (problems.length >= MISMATCH_LIMIT) return;
      let data: Uint8Array;
      try {
        data = new Uint8Array(
          await readFile(
            join(outDir, VERSIONS_DIR, version, ...path.split("/")),
          ),
        );
      } catch {
        problems.push(`${path} — не читается`);
        return;
      }
      const sha256 = sha256Hex(data);
      if (sha256 !== sums.files[path]) {
        problems.push(`${path} — не совпадает с контрольной суммой`);
        return;
      }
      files[i] = {
        key: `${base}${path}`,
        data,
        md5: md5Hex(data),
        sha256,
        contentType: contentTypeOf(path),
      };
    },
  );
  if (problems.length > 0) {
    throw new Error(
      `файлы на диске не сходятся с файлом сумм: ${problems.sort(order).slice(0, MISMATCH_LIMIT).join("; ")} — ${REBUILD}`,
    );
  }
  const out = files.filter((f): f is LocalFile => f !== undefined);
  out.push({
    key: sumsName,
    data: sumsBytes,
    md5: md5Hex(sumsBytes),
    sha256: sha256Hex(sumsBytes),
    contentType: contentTypeOf(sumsName),
  });
  return out;
}

export interface Comparison {
  present: LocalFile[];
  missing: LocalFile[];
  /** Ключи, которые в хранилище есть, но с другим размером или контрольной суммой. */
  conflicts: string[];
}

/**
 * Файлы версии против хранилища: совпадение — тот же размер и SHA-256, если хранилище его отдаёт
 * (Bunny), иначе ETag = MD5 (R2); без контрольной суммы сверить нечем — это тоже конфликт.
 */
export function compareWithRemote(
  files: readonly LocalFile[],
  remote: readonly RemoteObject[],
): Comparison {
  const byKey = new Map(remote.map((o) => [o.key, o] as const));
  const out: Comparison = { present: [], missing: [], conflicts: [] };
  for (const f of files) {
    const r = byKey.get(f.key);
    const size = f.data.byteLength;
    if (r === undefined) {
      out.missing.push(f);
    } else if (r.sha256 !== undefined) {
      if (r.size === size && r.sha256 === f.sha256) out.present.push(f);
      else {
        out.conflicts.push(
          `${f.key}: в хранилище ${r.size} Б, SHA-256 ${r.sha256}; локально ${size} Б, SHA-256 ${f.sha256}`,
        );
      }
    } else if (r.etag !== undefined) {
      if (r.size === size && r.etag === f.md5) out.present.push(f);
      else {
        out.conflicts.push(
          `${f.key}: в хранилище ${r.size} Б, ETag ${r.etag}; локально ${size} Б, MD5 ${f.md5}`,
        );
      }
    } else {
      out.conflicts.push(
        `${f.key}: в хранилище ${r.size} Б, а контрольной суммы в списке нет — сверить нечем`,
      );
    }
  }
  return out;
}

/** Объекты набора среди объектов по префиксу: папка набора и файл сумм, без соседей (ph и phosphor). */
export function setObjects(
  objects: readonly RemoteObject[],
  id: string,
  version: string,
): RemoteObject[] {
  const prefix = `${VERSIONS_DIR}/${version}/${id}`;
  return objects.filter(
    (o) =>
      o.key.startsWith(`${prefix}/`) ||
      o.key === `${prefix}${CHECKSUMS_SUFFIX}`,
  );
}

const bytesOf = (files: readonly LocalFile[]) =>
  files.reduce((n, f) => n + f.data.byteLength, 0);

const conflictMessage = (conflicts: readonly string[]) =>
  `в хранилище уже лежат другие файлы этой версии (${conflicts.length}): ${conflicts.slice(0, MISMATCH_LIMIT).join("; ")}. Версии неизменяемы — в v/ ничего не перезаписывается; разберитесь, откуда они`;

const emptySetReport = (id: string, version: string): SetUploadReport => ({
  id,
  version,
  files: 0,
  bytes: 0,
  present: 0,
  missing: 0,
  uploaded: 0,
  uploadedBytes: 0,
  ms: 0,
  status: "stopped",
  stop: [],
  samples: [],
});

interface SetsRun {
  manifest: Manifest;
  outDir: string;
  dryRun: boolean;
  concurrency: number;
  log: (line: string) => void;
  now: () => number;
}

/** Файлы версий всех наборов манифеста на один хост: недостающие, файл сумм последним, сверка. */
async function uploadSets(
  target: UploadHost,
  h: HostUploadReport,
  run: SetsRun,
): Promise<void> {
  const { client } = target;
  const { manifest, concurrency, dryRun, log, now } = run;
  const ids = Object.keys(manifest.sets).sort(order);
  for (const [n, id] of ids.entries()) {
    const version = manifest.sets[id]?.version ?? "";
    const r = emptySetReport(id, version);
    h.sets.push(r);
    const setStarted = now();
    let hostStopped = false;
    try {
      const files = await readSetFiles(run.outDir, id, version, concurrency);
      r.files = files.length;
      r.bytes = bytesOf(files);
      r.samples = files
        .slice(0, 2)
        .map((f) => f.key.slice(`${VERSIONS_DIR}/${version}/`.length))
        .filter((p) => !p.endsWith(CHECKSUMS_SUFFIX));
      const prefix = `${VERSIONS_DIR}/${version}/${id}`;
      const before = compareWithRemote(
        files,
        setObjects(await client.list(prefix), id, version),
      );
      r.present = before.present.length;
      r.missing = before.missing.length;
      if (before.conflicts.length > 0) {
        throw new Error(conflictMessage(before.conflicts));
      }
      if (before.missing.length === 0) {
        r.status = "unchanged";
        log(`${id}: все ${r.files} файлов версии ${version} уже в хранилище`);
      } else if (dryRun) {
        r.status = "planned";
        log(
          `${id}: будет выгружено ${r.missing} из ${r.files} файлов версии ${version} (${formatBytes(bytesOf(before.missing))})`,
        );
      } else {
        log(
          `${id}: выгружаю ${r.missing} из ${r.files} файлов версии ${version} (${formatBytes(bytesOf(before.missing))})…`,
        );
        const sumsKey = `${prefix}${CHECKSUMS_SUFFIX}`;
        const sums = before.missing.find((f) => f.key === sumsKey);
        const regular = before.missing.filter((f) => f.key !== sumsKey);
        const putFile = async (f: LocalFile) => {
          await client.put(f.key, f.data, {
            contentType: f.contentType,
            cacheControl: CACHE_IMMUTABLE,
            md5: f.md5,
            sha256: f.sha256,
          });
          r.uploaded++;
          r.uploadedBytes += f.data.byteLength;
        };
        let failure: Error | undefined;
        let done = 0;
        await pool(regular, concurrency, async (f) => {
          if (failure) return;
          try {
            await putFile(f);
            done++;
            if (done % PROGRESS_EVERY === 0) {
              log(`${id}: ${done} из ${regular.length}…`);
            }
          } catch (e) {
            failure ??= e instanceof Error ? e : new Error(String(e));
          }
        });
        if (failure) throw failure;
        // Файл сумм — последним: в хранилище он появляется, только когда все файлы версии на месте.
        if (sums) await putFile(sums);
        const after = compareWithRemote(
          files,
          setObjects(await client.list(prefix), id, version),
        );
        if (after.missing.length > 0 || after.conflicts.length > 0) {
          const details = [
            ...after.missing.map((f) => `${f.key} — нет в хранилище`),
            ...after.conflicts,
          ];
          throw new Error(
            `сверка после выгрузки не сошлась (нет в хранилище: ${after.missing.length}, отличаются: ${after.conflicts.length}): ${details.slice(0, MISMATCH_LIMIT).join("; ")}`,
          );
        }
        r.status = "uploaded";
        log(
          `${id}: выгружено ${r.uploaded} файлов (${formatBytes(r.uploadedBytes)}), сверка сошлась`,
        );
      }
    } catch (e) {
      const message = (e as Error).message;
      r.status = "stopped";
      r.stop.push(message);
      hostStopped = storageErrorScope(e) === "run";
      if (hostStopped) h.stop.push(message);
    } finally {
      r.ms = now() - setStarted;
    }
    if (hostStopped) {
      for (const rest of ids.slice(n + 1)) {
        const skipped = emptySetReport(
          rest,
          manifest.sets[rest]?.version ?? "",
        );
        skipped.stop.push("не проверялся: работа с хостом остановлена");
        h.sets.push(skipped);
      }
      return;
    }
  }
}

/** Почему манифест хоста не пишется из-за его собственного «СТОП». */
function ownStopNote(h: HostUploadReport): string {
  const stopped = h.sets.filter((s) => s.stop.length > 0).length;
  return h.stop.length > 0 || stopped === 0
    ? "работа с хостом остановлена"
    : `остановлено наборов: ${stopped}`;
}

/**
 * Выгружает все наборы манифеста на все хосты по очереди, затем манифесты — если ни один хост не
 * остановлен, в порядке хостов и только где манифест отличается от того, что в хранилище.
 */
export async function uploadCdn(options: UploadOptions): Promise<UploadReport> {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => performance.now());
  const concurrency = options.concurrency ?? UPLOAD_CONCURRENCY;
  const dryRun = options.dryRun === true;
  const started = now();
  const report: UploadReport = { dryRun, hosts: [], stop: [], ms: 0 };
  const finish = () => {
    report.ms = now() - started;
    return report;
  };

  let manifest: Manifest;
  let manifestText: string;
  try {
    manifestText = await readFile(join(options.outDir, MANIFEST_FILE), "utf8");
    const parsed = manifestSchema.safeParse(JSON.parse(manifestText));
    if (!parsed.success) throw new Error("не по схеме");
    manifest = parsed.data;
    report.manifest = manifestText;
  } catch {
    report.stop.push(
      `${MANIFEST_FILE} не читается или не по схеме — ${REBUILD}`,
    );
    return finish();
  }

  const hostStarted: number[] = [];
  for (const target of options.hosts) {
    const h: HostUploadReport = {
      host: target.host,
      storage: target.storage,
      sets: [],
      manifestStatus: "skipped",
      stop: [],
      ms: 0,
    };
    const earlier = report.hosts.find(hostStop);
    report.hosts.push(h);
    hostStarted.push(now());
    // Хосты не должны разойтись: файлы, которых нет на остановленном хосте, на следующий не идут.
    if (!dryRun && earlier !== undefined) {
      h.stop.push(
        `не выгружался: «СТОП» на ${earlier.host} — иначе хосты разойдутся`,
      );
      continue;
    }
    log(`Хост ${target.host} — ${target.storage}`);
    await uploadSets(target, h, {
      manifest,
      outDir: options.outDir,
      dryRun,
      concurrency,
      log,
      now,
    });
    h.ms = now() - (hostStarted.at(-1) ?? started);
  }

  // Манифесты — когда файлы версий есть на всех хостах; второй хост — последним (ADR-0025).
  for (const [i, target] of options.hosts.entries()) {
    const h = report.hosts[i];
    if (h === undefined) continue;
    const blocked = report.hosts.find((other) => hostStop(other));
    if (hostStop(h)) {
      h.manifestNote = ownStopNote(h);
      continue;
    }
    if (!dryRun && blocked !== undefined) {
      h.manifestNote = `«СТОП» на ${blocked.host}: манифесты пишутся, только когда новая версия есть на всех хостах`;
      continue;
    }
    const manifestStarted = now();
    try {
      const remote = await target.client.get(MANIFEST_FILE);
      if (remote !== undefined) h.remoteManifest = utf8(remote);
      if (h.remoteManifest === manifestText) {
        h.manifestStatus = "unchanged";
      } else if (dryRun) {
        h.manifestStatus = "planned";
      } else {
        const data = new Uint8Array(Buffer.from(manifestText, "utf8"));
        await target.client.put(MANIFEST_FILE, data, {
          contentType: contentTypeOf(MANIFEST_FILE),
          cacheControl: CACHE_MANIFEST,
          md5: md5Hex(data),
          sha256: sha256Hex(data),
        });
        h.manifestStatus = "written";
        log(`${target.host}: манифест записан`);
      }
    } catch (e) {
      h.stop.push(`${MANIFEST_FILE}: ${(e as Error).message}`);
      h.manifestNote = "не записался";
    } finally {
      h.ms += now() - manifestStarted;
    }
  }
  return finish();
}
