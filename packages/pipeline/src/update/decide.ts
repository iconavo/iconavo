// Решение по PR робота обновления наборов (ADR-0019): сольётся сам, ждёт владельца или сборка
// остановилась и слить его нельзя.

import type { LockEntry } from "../sources/lock.js";
import { compareVersions, parseVersion } from "../sources/version.js";
import type { SetSummary } from "./summary.js";

/** auto — сольётся сам; approval — ждёт владельца; problem — сборка остановилась. */
export type Decision = "auto" | "approval" | "problem";

export interface Verdict {
  decision: Decision;
  /** Почему PR ждёт владельца или не может быть слит; у auto — пусто. */
  reasons: string[];
  /** Сборку остановила только лицензия: владелец подтверждает текст прямо в ветке PR. */
  licenseOnly: boolean;
}

/** Номер версии: версия пакета npm или тег выпуска на коммите git; у коммита без тега номера нет. */
const numberOf = (e: LockEntry, tags?: ReadonlyMap<string, string>) =>
  e.type === "npm" ? e.version : tags?.get(e.commit);

/**
 * Версия у автора стала меньше закреплённой: latest пакета откатили или вручную закрепили старый
 * выпуск. Сравниваются номера; без номера (коммит без тега) — не откат: у коммитов порядка нет.
 */
export function isDowngrade(
  before: LockEntry | undefined,
  after: LockEntry,
  tags?: ReadonlyMap<string, string>,
): boolean {
  if (!before || before.type !== after.type) return false;
  const was = parseVersion(numberOf(before, tags) ?? "");
  const now = parseVersion(numberOf(after, tags) ?? "");
  return (
    was !== undefined && now !== undefined && compareVersions(now, was) < 0
  );
}

/**
 * Правила ADR-0019. Сборка остановилась — проблема; но если причина одна и это лицензия, PR ждёт
 * подтверждения владельца. Скрытия, переименования, новые находки контроля, исключённые иконки и
 * откат версии — ждут владельца. Остальное (иконки только добавлены или изменены) сливается само.
 */
export function decide(
  s: SetSummary,
  before: LockEntry | undefined,
  tags?: ReadonlyMap<string, string>,
): Verdict {
  const license = s.license.status;
  const licenseOnly =
    !s.written &&
    s.stop.length === 1 &&
    (license === "changed" || license === "unconfirmed");
  if (!s.written && !licenseOnly) {
    return {
      decision: "problem",
      reasons: s.stop.length > 0 ? [...s.stop] : ["файлы набора не записаны"],
      licenseOnly,
    };
  }
  const reasons: string[] = [];
  if (licenseOnly) {
    reasons.push(
      license === "changed"
        ? "лицензия изменилась у автора — нужно ваше подтверждение"
        : "лицензия ещё не подтверждена",
    );
  }
  const { changes } = s.release;
  if (s.release.needsApproval) {
    if (changes.hidden > 0) {
      reasons.push(`скрыты ${changes.hidden} — автор их удалил`);
    }
    if (changes.renamed > 0) {
      reasons.push(`переименованы ${changes.renamed}`);
    }
  }
  if (s.qc.attention.length > 0) {
    reasons.push(
      `новые находки контроля качества: ${s.qc.attention.length} — у добавленных или изменённых иконок`,
    );
  }
  if (s.excluded.length > 0) {
    reasons.push(
      `исключены при очистке: ${s.excluded.length} — у автора они есть, а в наборе их не будет`,
    );
  }
  if (before && isDowngrade(before, s.entry, tags)) {
    reasons.push(
      `версия у автора стала меньше: ${numberOf(before, tags)} → ${numberOf(s.entry, tags)}`,
    );
  }
  return {
    decision: reasons.length > 0 ? "approval" : "auto",
    reasons,
    licenseOnly,
  };
}
