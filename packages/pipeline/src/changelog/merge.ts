// Слияние прошлой версии набора со свежей сборкой (ADR-0005, ADR-0018): имена никогда не пропадают.
// Иконка, которой больше нет у автора, остаётся скрытой со старым рисунком; если тот же рисунок
// появился под другим именем, старое имя становится алиасом нового. Старшинство: свежая сборка, затем
// прошлая версия, затем прежние имена от автора — они только добавляют имена, которых ещё нет.

import { NAME_PATTERN } from "@iconavo-ui/schema";
import { fingerprint } from "../metadata/fingerprint.js";
import type { NormalizedIcon } from "../normalize/normalize.js";
import type { SetState, StateIcon } from "./state.js";

export interface FreshSet {
  /** Иконки свежей сборки, без алиасов. */
  icons: ReadonlyMap<string, NormalizedIcon>;
  /** Алиасы одинаковых вариантов (ADR-0002): алиас → родитель-иконка. */
  aliases: ReadonlyMap<string, string>;
}

/** Прежнее имя от автора: Lucide и Phosphor хранят их в своих метаданных. */
export interface AuthorAlias {
  name: string;
  parent: string;
}

export interface SkippedAlias extends AuthorAlias {
  reason: string;
}

/** Что изменилось с прошлой версии; списки — по кодам символов. */
export interface HistoryChanges {
  /** Новые иконки. */
  added: string[];
  /** Рисунок изменился: другой отпечаток. */
  changed: string[];
  /** Были скрыты, а теперь снова есть у автора. */
  restored: string[];
  /** Автор удалил: иконка осталась с пометкой hidden. */
  hidden: string[];
  /** Старое имя → новое: старое стало алиасом. */
  renamed: Map<string, string>;
  /** Новые алиасы известных иконок: алиас → родитель. */
  aliases: Map<string, string>;
}

export interface MergeResult {
  /** Итог: иконки (со скрытыми) и алиасы. */
  state: SetState;
  changes: HistoryChanges;
  /** Прежние имена от автора, которые не добавлены, с причиной. */
  skipped: SkippedAlias[];
  /** Нарушенные проверки — причины «СТОП». */
  problems: string[];
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const noChanges = (): HistoryChanges => ({
  added: [],
  changed: [],
  restored: [],
  hidden: [],
  renamed: new Map(),
  aliases: new Map(),
});

export const hasChanges = (c: HistoryChanges): boolean =>
  c.added.length +
    c.changed.length +
    c.restored.length +
    c.hidden.length +
    c.renamed.size +
    c.aliases.size >
  0;

/**
 * Итог слияния. baseline — прошлая версия; нет — набор новый, и списков изменений нет. Повторное
 * слияние итога с той же свежей сборкой даёт тот же итог без изменений: на этом держится побайтно
 * одинаковая повторная сборка.
 */
export function mergeHistory(
  prefix: string,
  baseline: SetState | undefined,
  fresh: FreshSet,
  extra: readonly AuthorAlias[],
): MergeResult {
  const icons = new Map<string, StateIcon>();
  for (const name of [...fresh.icons.keys()].sort(order)) {
    icons.set(name, {
      icon: fresh.icons.get(name) as NormalizedIcon,
      hidden: false,
    });
  }
  const aliases = new Map<string, string>();
  for (const name of [...fresh.aliases.keys()].sort(order)) {
    aliases.set(name, fresh.aliases.get(name) as string);
  }
  const changes = noChanges();
  const skipped: SkippedAlias[] = [];
  const problems: string[] = [];
  const inFresh = (name: string) =>
    fresh.icons.has(name) || fresh.aliases.has(name);
  const inBaseline = (name: string) =>
    baseline !== undefined &&
    (baseline.icons.has(name) || baseline.aliases.has(name));
  /** Иконка, к которой имя ведёт в итоге: у иконки — она сама, у алиаса — родитель. */
  const target = (name: string) => (icons.has(name) ? name : aliases.get(name));

  if (baseline) {
    // Иконки свежей сборки по отпечатку: сначала имена, которых не было, затем по кодам символов.
    const byPrint = new Map<string, string[]>();
    for (const [name, icon] of fresh.icons) {
      const key = fingerprint(prefix, name, icon);
      byPrint.set(key, [...(byPrint.get(key) ?? []), name]);
    }
    const rank = (name: string) => (inBaseline(name) ? 1 : 0);
    for (const list of byPrint.values()) {
      list.sort((a, b) => rank(a) - rank(b) || order(a, b));
    }

    // 1. Иконки прошлой версии, которых нет в источнике: переименование или скрытие.
    for (const name of [...baseline.icons.keys()].sort(order)) {
      if (inFresh(name)) continue;
      const was = baseline.icons.get(name) as StateIcon;
      const to = byPrint.get(fingerprint(prefix, name, was.icon))?.[0];
      if (to !== undefined) {
        aliases.set(name, to);
        changes.renamed.set(name, to);
      } else {
        icons.set(name, { icon: was.icon, hidden: true });
        if (!was.hidden) changes.hidden.push(name);
      }
    }
    // 2. Алиасы прошлой версии, которых нет в источнике, переносятся; родитель — иконка итога.
    for (const name of [...baseline.aliases.keys()].sort(order)) {
      if (inFresh(name)) continue;
      const parent = target(baseline.aliases.get(name) as string);
      if (parent === undefined) {
        problems.push(`алиас «${name}» прошлой версии потерял родителя`);
      } else {
        aliases.set(name, parent);
      }
    }
  }

  // 3. Прежние имена от автора — только те, которых в итоге ещё нет.
  const sorted = [...extra].sort(
    (a, b) => order(a.name, b.name) || order(a.parent, b.parent),
  );
  for (const alias of sorted) {
    const parent = target(alias.parent);
    const skip = (reason: string) => skipped.push({ ...alias, reason });
    if (!NAME_PATTERN.test(alias.name)) {
      skip("имя не по правилу ADR-0001");
    } else if (icons.has(alias.name) || aliases.has(alias.name)) {
      // Имя уже ведёт туда же (например, переименование нашлось по отпечатку) — это не пропуск.
      if (target(alias.name) !== parent) {
        skip(
          icons.has(alias.name)
            ? "имя занято иконкой"
            : `имя уже ведёт на ${aliases.get(alias.name)}`,
        );
      }
    } else if (parent === undefined) {
      skip(`нет иконки ${alias.parent}`);
    } else {
      aliases.set(alias.name, parent);
    }
  }

  const state: SetState = { icons, aliases };

  // 4. Изменения: новые имена, вернувшиеся и изменившиеся иконки.
  if (baseline) {
    const renamedTo = new Set(changes.renamed.values());
    const print = (s: SetState, name: string) => {
      const parent = s.aliases.get(name) ?? name;
      const icon = s.icons.get(parent)?.icon;
      return icon && fingerprint(prefix, parent, icon);
    };
    for (const name of [...icons.keys(), ...aliases.keys()].sort(order)) {
      if (!inBaseline(name)) {
        const parent = aliases.get(name);
        if (parent === undefined) {
          // Цель переименования показана среди переименований, а не среди новых.
          if (!renamedTo.has(name)) changes.added.push(name);
        } else if (inBaseline(parent)) {
          // Алиасы новых иконок отдельно не перечисляются: они приходят вместе с иконкой.
          changes.aliases.set(name, parent);
        }
        continue;
      }
      // Скрытые, переименованные и перенесённые алиасы уже учтены в шагах 1–2.
      if (!inFresh(name)) continue;
      if (baseline.icons.get(name)?.hidden) {
        changes.restored.push(name);
        continue;
      }
      // Алиас, который ведёт на того же родителя, меняется вместе с ним — показывается родитель.
      const parent = baseline.aliases.get(name);
      if (parent !== undefined && parent === aliases.get(name)) continue;
      if (print(baseline, name) !== print(state, name)) {
        changes.changed.push(name);
      }
    }
  }

  // Проверки: имена прошлой версии на месте, родитель алиаса — иконка.
  if (baseline) {
    for (const name of [...baseline.icons.keys(), ...baseline.aliases.keys()]) {
      if (!icons.has(name) && !aliases.has(name)) {
        problems.push(`имя «${name}» прошлой версии пропало`);
      }
    }
  }
  for (const [name, parent] of aliases) {
    if (icons.has(name)) problems.push(`«${name}» — и иконка, и алиас`);
    if (!icons.has(parent)) {
      problems.push(`родитель алиаса «${name}» — «${parent}», а он не иконка`);
    }
  }
  return { state, changes, skipped, problems };
}
