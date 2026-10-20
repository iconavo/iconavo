// Журнал набора при сборке (ADR-0018): прошлая версия сливается со свежей сборкой и прежними именами
// от автора, считается версия набора, следующий журнал и тексты changelog.json и CHANGELOG.md.
// Любая причина «СТОП» не даёт записать ни одного файла набора.

import { type ChangelogFile, validate } from "@iconavo-ui/schema";
import { canonicalJson, type Json } from "../build/json.js";
import type { AuthorMetadata } from "../metadata/formats.js";
import type { SetFile } from "../metadata/run.js";
import type { Baseline } from "../qc/baseline.js";
import { folderMatcher, type SourceConfig } from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";
import { iconNameFromFile } from "../sources/names.js";
import { changelogMarkdown, nextChangelog } from "./journal.js";
import {
  type AuthorAlias,
  type FreshSet,
  type HistoryChanges,
  hasChanges,
  mergeHistory,
  type SkippedAlias,
} from "./merge.js";
import {
  iconsFileOf,
  type SetState,
  sameState,
  versionOf,
  visibleCount,
} from "./state.js";

export interface SetChangelog {
  /** Прошлая версия — иконки и алиасы; нет — набор новый или прошлая версия не читается. */
  before?: SetState;
  /** Версия прошлого выпуска; нет — журнал начинается с этой сборки. */
  previous?: string;
  version: string;
  /** new — новый выпуск; same — версия не изменилась, журнал тот же. */
  release: "new" | "same";
  /** Что изменилось с прошлой версии. */
  changes: HistoryChanges;
  /** Прежние имена от автора, которые не стали алиасами, с причиной. */
  skipped: SkippedAlias[];
  /** Итог: иконки (со скрытыми) и все алиасы — то, что записывается в icons.json. */
  state: SetState;
  /** Данные icons.json вместе с lastModified. */
  data: { [key: string]: Json };
  /** Журнал целиком. */
  file: ChangelogFile;
  /** Тексты changelog.json и CHANGELOG.md; нет — набор остановлен. */
  files?: SetFile[];
  stop: string[];
}

export interface ChangelogOptions {
  /** Прошлая версия набора (ADR-0016, ADR-0018). */
  baseline?: Baseline;
  /** Прошлая версия есть, но не читается — «СТОП». */
  baselineError?: string;
  /** Сейчас — секунды Unix: дата нового выпуска. */
  now: number;
  /** Журнал, который сейчас лежит в data/{набор}/changelog.json, — разобранный JSON. */
  pending?: unknown;
}

/**
 * Прежние имена от автора: пути SVG под старыми именами превращаются в имена по правилам папки
 * набора — так же, как имена самих иконок.
 */
export function authorAliases(
  config: SourceConfig,
  files: readonly { name: string; file: string }[],
  author: ReadonlyMap<string, AuthorMetadata>,
): { aliases: AuthorAlias[]; skipped: SkippedAlias[] } {
  const folderOf = folderMatcher(config);
  const aliases: AuthorAlias[] = [];
  const skipped: SkippedAlias[] = [];
  for (const { name, file } of files) {
    for (const path of author.get(file)?.aliases ?? []) {
      const folder = folderOf(path);
      if (folder) {
        aliases.push({
          name: iconNameFromFile(path, folder.naming),
          parent: name,
        });
      } else {
        skipped.push({
          name: path,
          parent: name,
          reason: "путь вне папок набора",
        });
      }
    }
  }
  return { aliases, skipped };
}

/** Журнал набора: итог слияния, версия, следующий журнал и его тексты. */
export function setChangelog(
  config: SourceConfig,
  entry: LockEntry,
  fresh: FreshSet,
  extra: { aliases: readonly AuthorAlias[]; skipped: readonly SkippedAlias[] },
  options: ChangelogOptions,
): SetChangelog {
  const stop: string[] = [];
  if (options.baselineError !== undefined) {
    stop.push(
      `прошлая версия не читается — ${options.baselineError}. Без неё пропали бы скрытые иконки и алиасы (ADR-0005)`,
    );
  }
  const before = options.baseline?.state;
  const merged = mergeHistory(config.id, before, fresh, extra.aliases);
  for (const p of merged.problems) stop.push(`журнал: ${p}`);
  // Итог, слитый с той же сборкой ещё раз, не должен меняться: иначе повторная сборка дала бы
  // другие файлы, и проверка в CI упала бы.
  const again = mergeHistory(config.id, merged.state, fresh, extra.aliases);
  if (!sameState(again.state, merged.state) || hasChanges(again.changes)) {
    stop.push(
      "журнал: повторное слияние дало другой результат — ошибка в коде журнала",
    );
  }

  const version = versionOf(iconsFileOf(config.id, config.grid, merged.state));
  const previous = options.baseline?.changelog;
  const journal = nextChangelog({
    prefix: config.id,
    version,
    revision: entry.type === "npm" ? entry.version : entry.commit,
    total: visibleCount(merged.state),
    changes: merged.changes,
    previous,
    pending: options.pending,
    now: options.now,
  });
  const issues = validate("changelog", journal.file);
  if (issues.length > 0) {
    stop.push(
      `changelog.json не прошёл проверку схемы: ${issues
        .slice(0, 3)
        .map((i) => `${i.path} — ${i.message}`)
        .join("; ")}`,
    );
  }

  const prev = previous?.releases[0]?.version;
  const result: SetChangelog = {
    ...(before ? { before } : {}),
    ...(prev === undefined ? {} : { previous: prev }),
    version,
    release: journal.release,
    changes: merged.changes,
    skipped: [...extra.skipped, ...merged.skipped],
    state: merged.state,
    data: iconsFileOf(
      config.id,
      config.grid,
      merged.state,
      journal.lastModified,
    ),
    file: journal.file,
    stop,
  };
  if (stop.length === 0) {
    result.files = [
      {
        name: "changelog.json",
        text: canonicalJson(journal.file as unknown as Json),
      },
      {
        name: "CHANGELOG.md",
        text: changelogMarkdown(config.name, journal.file),
      },
    ];
  }
  return result;
}
