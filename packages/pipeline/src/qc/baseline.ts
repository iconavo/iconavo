// Прошлая версия набора (ADR-0016, ADR-0018): последний коммит, в котором менялись
// data/{набор}/icons.json или changelog.json, не новее версии в main (см. baseRevision), и запись о
// наборе в sources.lock.json того же коммита. Так обновление версии источника, закоммиченное до
// пересборки, не примут за поломку сборки, а все изменения ветки попадут в один выпуск журнала.

import { type ChangelogFile, changelogFileSchema } from "@iconavo-ui/schema";
import { flatten, type SetState, stateOf } from "../changelog/state.js";
import type { NormalizedIcon } from "../normalize/normalize.js";
import type { SourceConfig } from "../sources/config.js";
import { sourceLabel } from "../sources/fetch.js";
import { gitShow, lastCommit } from "../sources/git.js";
import { type LockEntry, lockFileSchema } from "../sources/lock.js";

export interface Baseline {
  /** С чем сравниваем — для отчёта: «коммит 7538fab, @tabler/icons@3.49.0». */
  label: string;
  /** Источник обновился с прошлой версии: тогда изменения иконок ожидаемы. */
  sourceChanged: boolean;
  /** Все имена прошлой версии; у алиаса — тело и размер родителя. */
  icons: ReadonlyMap<string, NormalizedIcon>;
  /** Иконки с пометкой hidden и алиасы — для журнала (ADR-0018); нет — сравнивает только контроль. */
  state?: SetState;
  /** Журнал прошлой версии; нет — журнал начинается с этой сборки. */
  changelog?: ChangelogFile;
}

/** История файлов проекта: в CLI — git, в тестах — подстановка. */
export interface History {
  /** Последний коммит, в котором менялся хотя бы один из файлов; файлов нет в истории — undefined. */
  lastCommit(paths: readonly string[]): Promise<string | undefined>;
  /** Файл в коммите; в коммите его нет — undefined. */
  show(commit: string, path: string): Promise<string | undefined>;
}

/** История репозитория через git: пути — от его корня, коммиты — не новее from. */
export const gitHistory = (root: string, from = "HEAD"): History => ({
  lastCommit: (paths) => lastCommit(paths, root, from),
  show: (commit, path) => gitShow(commit, path, root),
});

/**
 * Имена набора с телами: алиас получает тело и размер родителя (ADR-0002). Повороты и отражения
 * у алиасов не учитываются — наши алиасы их не используют.
 */
export function iconsByName(data: unknown): Map<string, NormalizedIcon> {
  return flatten(stateOf(data));
}

/** Прошлая версия из текстов файлов: icons.json и, если он уже был, changelog.json. */
export function baselineFromTexts(input: {
  label: string;
  sourceChanged: boolean;
  icons: string;
  changelog?: string;
}): Baseline {
  const state = stateOf(JSON.parse(input.icons));
  return {
    label: input.label,
    sourceChanged: input.sourceChanged,
    icons: flatten(state),
    state,
    ...(input.changelog === undefined
      ? {}
      : { changelog: changelogFileSchema.parse(JSON.parse(input.changelog)) }),
  };
}

/**
 * Прошлая версия набора. baselineNote — сравнивать не с чем: набора ещё нет в истории. baselineError —
 * прошлая версия есть, но не читается: набор останавливается, иначе пропали бы скрытые иконки и
 * алиасы (ADR-0005).
 */
export async function loadBaseline(
  history: History,
  config: SourceConfig,
  current: LockEntry,
): Promise<{
  baseline?: Baseline;
  baselineNote?: string;
  baselineError?: string;
}> {
  const iconsPath = `data/${config.id}/icons.json`;
  const changelogPath = `data/${config.id}/changelog.json`;
  let commit: string | undefined;
  try {
    commit = await history.lastCommit([iconsPath, changelogPath]);
  } catch (e) {
    return {
      baselineError: `история git недоступна — ${(e as Error).message}`,
    };
  }
  if (commit === undefined) {
    return { baselineNote: `${iconsPath} ещё нет в истории git` };
  }
  const short = commit.slice(0, 7);
  try {
    const icons = await history.show(commit, iconsPath);
    if (icons === undefined) {
      return { baselineError: `в коммите ${short} нет ${iconsPath}` };
    }
    const changelog = await history.show(commit, changelogPath);
    // Lock того же коммита; не читается — считаем, что источник обновился.
    const lockText = await history.show(commit, "sources.lock.json");
    const lock =
      lockText === undefined
        ? undefined
        : lockFileSchema.safeParse(JSON.parse(lockText));
    const previous = lock?.success ? lock.data[config.id] : undefined;
    return {
      baseline: baselineFromTexts({
        label:
          previous === undefined
            ? `коммит ${short}`
            : `коммит ${short}, ${sourceLabel(config, previous)}`,
        sourceChanged:
          previous === undefined ||
          JSON.stringify(previous) !== JSON.stringify(current),
        icons,
        ...(changelog === undefined ? {} : { changelog }),
      }),
    };
  } catch (e) {
    return {
      baselineError: `прошлая версия из коммита ${short} не читается — ${(e as Error).message}`,
    };
  }
}
