// Журнал выпусков набора (ADR-0018): changelog.json для сайта и CI и CHANGELOG.md для людей.
// Выпуск — версия набора, отличная от прошлой. Повторная сборка без изменений журнал не трогает, а
// повторная сборка ещё не слитого выпуска сохраняет его дату.

import {
  type ChangelogFile,
  changelogFileSchema,
  type Release,
} from "@iconavo-ui/schema";
import type { HistoryChanges } from "./merge.js";

export interface ChangelogInput {
  prefix: string;
  version: string;
  /** Версия пакета npm или коммит git источника. */
  revision: string;
  /** Видимых иконок в выпуске. */
  total: number;
  changes: HistoryChanges;
  /** Журнал прошлой версии; нет — журнал начинается с этой сборки. */
  previous?: ChangelogFile;
  /** Журнал, который сейчас лежит в data/: если в нём этот же выпуск, его дата сохраняется. */
  pending?: unknown;
  /** Сейчас — секунды Unix. */
  now: number;
}

export interface NextChangelog {
  file: ChangelogFile;
  /** new — сверху новый выпуск; same — версия не изменилась, журнал прошлой версии как есть. */
  release: "new" | "same";
  /** Время последнего выпуска в секундах — lastModified в icons.json. */
  lastModified: number;
}

/** Сколько имён показывать в каждом списке CHANGELOG.md; полные списки — в changelog.json. */
export const MARKDOWN_LIMIT = 50;

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Дата ISO по UTC с точностью до секунды: 2026-10-22T09:15:00Z. */
export const isoDate = (seconds: number) =>
  new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Секунды Unix из даты ISO. */
export const secondsOf = (date: string) => Math.floor(Date.parse(date) / 1000);

/** Выпуск, который вы одобряете лично (ADR-0019): в нём есть скрытые или переименованные иконки. */
export const needsApproval = (release: Release) =>
  (release.hidden?.length ?? 0) > 0 ||
  Object.keys(release.renamed ?? {}).length > 0;

/** Списки выпуска: пустые не пишутся (ADR-0018). */
function listsOf(c: HistoryChanges): Partial<Release> {
  const out: Partial<Release> = {};
  if (c.added.length > 0) out.added = c.added;
  if (c.changed.length > 0) out.changed = c.changed;
  if (c.restored.length > 0) out.restored = c.restored;
  if (c.hidden.length > 0) out.hidden = c.hidden;
  if (c.renamed.size > 0) out.renamed = Object.fromEntries(c.renamed);
  if (c.aliases.size > 0) out.aliases = Object.fromEntries(c.aliases);
  return out;
}

/**
 * Следующий журнал. Версия та же, что у последнего выпуска, — журнал прошлой версии без изменений.
 * Иначе сверху новый выпуск. Его дата берётся из журнала на диске, если там этот же выпуск: те же
 * версия и прошлая версия. Если нет — сейчас, но не раньше прошлого выпуска: даты только растут.
 */
export function nextChangelog(input: ChangelogInput): NextChangelog {
  const { previous } = input;
  const prev = previous?.releases[0];
  if (previous && prev && prev.version === input.version) {
    return {
      file: previous,
      release: "same",
      lastModified: secondsOf(prev.date),
    };
  }
  // Журнал на диске может быть любым: сломанным, чужим — тогда он просто не используется.
  const pending = changelogFileSchema.safeParse(input.pending);
  const top =
    pending.success && pending.data.prefix === input.prefix
      ? pending.data.releases[0]
      : undefined;
  const date =
    top?.version === input.version && top.previous === prev?.version
      ? top.date
      : isoDate(Math.max(input.now, prev ? secondsOf(prev.date) + 1 : 0));
  const release: Release = {
    version: input.version,
    ...(prev ? { previous: prev.version } : {}),
    date,
    revision: input.revision,
    total: input.total,
    ...listsOf(input.changes),
  };
  return {
    file: {
      prefix: input.prefix,
      releases: [release, ...(previous?.releases ?? [])],
    },
    release: "new",
    lastModified: secondsOf(date),
  };
}

/** «22 октября 2026» по UTC — без Intl: текст не зависит от настроек системы. */
export function humanDate(date: string): string {
  const d = new Date(Date.parse(date));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Число с пробелами между разрядами: 15 753. */
export const groupDigits = (n: number) =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Коммит — первые 7 символов, версия пакета — как есть. */
const shortRevision = (revision: string) =>
  /^[0-9a-f]{40}$/.test(revision) ? revision.slice(0, 7) : revision;

/** Имена в обратных кавычках; длинный список обрезается. */
function namesLine(items: readonly string[]): string {
  const shown = items.slice(0, MARKDOWN_LIMIT).join(", ");
  return items.length > MARKDOWN_LIMIT
    ? `${shown} … и ещё ${groupDigits(items.length - MARKDOWN_LIMIT)} — полный список в changelog.json`
    : shown;
}

const code = (name: string) => `\`${name}\``;
const pairs = (record: Record<string, string> | undefined) =>
  Object.entries(record ?? {})
    .sort(([a], [b]) => order(a, b))
    .map(([from, to]) => `${code(from)} → ${code(to)}`);

/** Раздел одного выпуска в CHANGELOG.md; его же робот обновления кладёт в описание PR (ADR-0019). */
export function releaseSection(r: Release): string {
  const lines = [`## ${humanDate(r.date)} · версия ${r.version}`, ""];
  const source = `источник: ${shortRevision(r.revision)} · иконок: ${groupDigits(r.total)}`;
  lines.push(
    r.previous === undefined
      ? `Начало журнала · ${source}.`
      : `Прошлая версия: ${r.previous} · ${source}.`,
  );
  const item = (title: string, list: readonly string[]) =>
    list.length > 0
      ? [`- ${title} (${groupDigits(list.length)}): ${namesLine(list)}`]
      : [];
  if (needsApproval(r)) {
    lines.push(
      "",
      "**Требуют вашего одобрения**",
      "",
      ...item(
        "Скрыты — автор удалил, имя продолжает работать",
        (r.hidden ?? []).map(code),
      ),
      ...item("Переименованы — старое имя ведёт на новое", pairs(r.renamed)),
    );
  }
  const other = [
    ...item("Добавлены", (r.added ?? []).map(code)),
    ...item("Изменены", (r.changed ?? []).map(code)),
    ...item("Вернулись", (r.restored ?? []).map(code)),
    ...item("Новые алиасы", pairs(r.aliases)),
  ];
  if (other.length > 0) {
    lines.push("", "**Изменения**", "", ...other);
  } else if (r.previous !== undefined && !needsApproval(r)) {
    lines.push(
      "",
      "Рисунки и имена не изменились — обновлён только файл набора.",
    );
  }
  return lines.join("\n");
}

/** CHANGELOG.md: короткая легенда и выпуски от свежих к старым. */
export function changelogMarkdown(
  setName: string,
  file: ChangelogFile,
): string {
  const head = [
    `# Журнал изменений — ${setName}`,
    "",
    "Выпуск — новая версия набора: она меняется, когда в `icons.json` меняется хоть что-то (ADR-0018).",
    "Имена не пропадают: иконка, которую удалил автор, скрыта, но работает по имени, а старое имя переименованной ведёт на новое (ADR-0005).",
    "Скрытия и переименования вы одобряете лично в pull request (ADR-0019). Полные списки — в `changelog.json`.",
  ].join("\n");
  return `${[head, ...file.releases.map(releaseSection)].join("\n\n")}\n`;
}
