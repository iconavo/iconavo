// Сводка сборки для CI (ADR-0019): что pnpm data узнал о каждом наборе — без картинок и текстов файлов.
// Пишется в .cache/reports/data/summary.json при каждом запуске; по ней pnpm pr решает, сольётся ли PR
// робота обновления сам, и пишет его описание.

import { releaseSchema } from "@iconavo-ui/schema";
import { z } from "zod";
import type { SetBuildReport } from "../build/run.js";
import { needsApproval } from "../changelog/journal.js";
import { QC_KINDS, type QcKind } from "../qc/run.js";
import type { SourceConfig } from "../sources/config.js";
import { type LockEntry, lockEntrySchema } from "../sources/lock.js";

export const SUMMARY_FILE = "summary.json";

/**
 * Находки контроля, которые у новых и изменённых иконок ждут владельца (ADR-0019). Пустые и
 * ненарисованные и так останавливают набор, а «изменилась» — это и есть обновление.
 */
export const ATTENTION_KINDS = ["sparse", "cropped", "original"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

const isAttention = (kind: QcKind): kind is AttentionKind =>
  (ATTENTION_KINDS as readonly QcKind[]).includes(kind);

const count = z.number().int().nonnegative();

export const setSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  /** Подпись источника: `@tabler/icons@3.49.0` или `https://github.com/x/y@abcdef0`. */
  source: z.string(),
  /** Запись набора в sources.lock.json, с которой шла сборка. */
  entry: lockEntrySchema,
  /** Файлы набора записаны в data/; false — сборка остановилась. */
  written: z.boolean(),
  stop: z.array(z.string()),
  /** Исключённые при очистке и нормализации: у автора они есть, а в наборе их не будет. */
  excluded: z.array(z.strictObject({ name: z.string(), reason: z.string() })),
  release: z.strictObject({
    /** new — новый выпуск; same — рисунки и имена те же, журнал не меняется. */
    status: z.enum(["new", "same"]),
    version: z.string(),
    previous: z.string().optional(),
    /** Видимых иконок. */
    total: count,
    changes: z.strictObject({
      added: count,
      changed: count,
      restored: count,
      hidden: count,
      renamed: count,
      aliases: count,
    }),
    /** В новом выпуске есть скрытия или переименования (needsApproval). */
    needsApproval: z.boolean(),
    /** Новый выпуск как в changelog.json. У same его нет: верхний выпуск журнала — старый. */
    top: releaseSchema.optional(),
  }),
  qc: z.strictObject({
    /** Сколько иконок нарисовано. */
    checked: count,
    counts: z.record(z.enum(QC_KINDS), count),
    /** Находки ATTENTION_KINDS у добавленных, изменённых, вернувшихся и переименованных иконок. */
    attention: z.array(
      z.strictObject({
        kind: z.enum(ATTENTION_KINDS),
        name: z.string(),
        text: z.string(),
      }),
    ),
    /** С чем сравнивали или почему не с чем. */
    baseline: z.string().optional(),
  }),
  license: z.strictObject({
    spdx: z.string(),
    /** Нет — текст лицензии не прочитан (причина — в stop). */
    status: z.enum(["confirmed", "unconfirmed", "changed"]).optional(),
    hash: z.string().optional(),
  }),
});

export const buildSummarySchema = z.strictObject({
  /** Прошлая версия наборов: «версия в main (коммит …)». */
  base: z.string(),
  sets: z.array(setSummarySchema),
  /** Наборы, которые не собрались вовсе (не скачаны, ошибка чтения): это сбой, а не «СТОП». */
  errors: z.array(z.strictObject({ id: z.string(), message: z.string() })),
});

export type SetSummary = z.infer<typeof setSummarySchema>;
export type BuildSummary = z.infer<typeof buildSummarySchema>;

/** Сводка по отчёту сборки набора; written — файлы набора записаны (writeSetData). */
export function setSummary(
  config: SourceConfig,
  r: SetBuildReport,
  entry: LockEntry,
  written: boolean,
): SetSummary {
  const { changes } = r.changelog;
  const top =
    r.changelog.release === "new"
      ? releaseSchema.safeParse(r.changelog.file.releases[0])
      : undefined;
  // Новые находки — у иконок, которые в этом выпуске появились или изменились; без прошлой версии
  // новое всё.
  const touched = new Set([
    ...changes.added,
    ...changes.changed,
    ...changes.restored,
    ...changes.renamed.values(),
  ]);
  const isNew = (name: string) =>
    r.qc.baseline === undefined || touched.has(name);
  const baseline = r.qc.baseline?.label ?? r.qc.baselineNote;
  const license = r.metadata.license;
  return {
    id: config.id,
    name: config.name,
    source: r.normalize.source,
    entry,
    written,
    stop: [...r.stop],
    excluded: r.normalize.excluded.map((e) => ({
      name: e.name,
      reason: e.reason,
    })),
    release: {
      status: r.changelog.release,
      version: r.changelog.version,
      ...(r.changelog.previous === undefined
        ? {}
        : { previous: r.changelog.previous }),
      total: r.icons.length,
      changes: {
        added: changes.added.length,
        changed: changes.changed.length,
        restored: changes.restored.length,
        hidden: changes.hidden.length,
        renamed: changes.renamed.size,
        aliases: changes.aliases.size,
      },
      needsApproval: top?.success === true && needsApproval(top.data),
      ...(top?.success ? { top: top.data } : {}),
    },
    qc: {
      checked: r.qc.checked,
      counts: Object.fromEntries(
        QC_KINDS.map((kind) => [
          kind,
          r.qc.findings.filter((f) => f.kind === kind).length,
        ]),
      ) as Record<QcKind, number>,
      attention: r.qc.findings.flatMap((f) =>
        isAttention(f.kind) && isNew(f.name)
          ? [{ kind: f.kind, name: f.name, text: f.text }]
          : [],
      ),
      ...(baseline === undefined ? {} : { baseline }),
    },
    license: {
      spdx: config.license.spdx,
      ...(license ? { status: license.status, hash: license.hash } : {}),
    },
  };
}

/** Текст summary.json: отступ 2 пробела, перевод строки в конце. */
export const summaryText = (summary: BuildSummary) =>
  `${JSON.stringify(summary, null, 2)}\n`;
