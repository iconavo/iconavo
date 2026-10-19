// Прошлая версия набора для сравнения (ADR-0016): последний коммит, в котором менялся
// data/{набор}/icons.json, и запись о наборе в sources.lock.json того же коммита. Так обновление
// версии источника, закоммиченное до пересборки, не примут за поломку сборки.

import { iconsFileSchema } from "@iconavo-ui/schema";
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
}

/** История файлов проекта: в CLI — git, в тестах — подстановка. */
export interface History {
  /** Последний коммит, в котором менялся файл; файла нет в истории — undefined. */
  lastCommit(path: string): Promise<string | undefined>;
  /** Файл в коммите; в коммите его нет — undefined. */
  show(commit: string, path: string): Promise<string | undefined>;
}

/** История репозитория через git; пути — от его корня. */
export const gitHistory = (root: string): History => ({
  lastCommit: (path) => lastCommit(path, root),
  show: (commit, path) => gitShow(commit, path, root),
});

/**
 * Имена набора с телами: алиас получает тело и размер родителя (ADR-0002). Повороты и отражения
 * у алиасов не учитываются — наши алиасы их не используют.
 */
export function iconsByName(data: unknown): Map<string, NormalizedIcon> {
  const file = iconsFileSchema.parse(data);
  // По умолчанию у IconifyJSON размер 16.
  const width = file.width ?? 16;
  const height = file.height ?? 16;
  const out = new Map<string, NormalizedIcon>();
  for (const [name, icon] of Object.entries(file.icons)) {
    out.set(name, {
      body: icon.body,
      width: icon.width ?? width,
      height: icon.height ?? height,
    });
  }
  for (const name of Object.keys(file.aliases ?? {})) {
    // В IconifyJSON алиас может ссылаться на алиас; у нас цепочек нет, но идём до 10 шагов.
    let target = name;
    for (let step = 0; step < 10; step++) {
      const alias = file.aliases?.[target];
      if (!alias) break;
      target = alias.parent;
    }
    const icon = out.get(target);
    if (icon) out.set(name, icon);
  }
  return out;
}

/** Прошлая версия набора или причина, почему сравнивать не с чем. */
export async function loadBaseline(
  history: History,
  config: SourceConfig,
  current: LockEntry,
): Promise<{ baseline?: Baseline; baselineNote?: string }> {
  const path = `data/${config.id}/icons.json`;
  let commit: string | undefined;
  try {
    commit = await history.lastCommit(path);
  } catch (e) {
    return {
      baselineNote: `история git недоступна — ${(e as Error).message}`,
    };
  }
  if (commit === undefined) {
    return { baselineNote: `${path} ещё нет в истории git` };
  }
  const short = commit.slice(0, 7);
  try {
    const text = await history.show(commit, path);
    if (text === undefined) {
      return { baselineNote: `в коммите ${short} нет ${path}` };
    }
    const icons = iconsByName(JSON.parse(text));
    // Lock того же коммита; не читается — считаем, что источник обновился.
    const lockText = await history.show(commit, "sources.lock.json");
    const lock =
      lockText === undefined
        ? undefined
        : lockFileSchema.safeParse(JSON.parse(lockText));
    const previous = lock?.success ? lock.data[config.id] : undefined;
    return {
      baseline: {
        label:
          previous === undefined
            ? `коммит ${short}`
            : `коммит ${short}, ${sourceLabel(config, previous)}`,
        sourceChanged:
          previous === undefined ||
          JSON.stringify(previous) !== JSON.stringify(current),
        icons,
      },
    };
  } catch (e) {
    return {
      baselineNote: `прошлая версия из коммита ${short} не читается — ${(e as Error).message}`,
    };
  }
}
