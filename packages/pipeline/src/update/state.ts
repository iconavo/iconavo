// Что робот обновления делает с PR набора (ADR-0019): собирает, не трогает, версия отклонена,
// закрывает, ничего — или останавливается. Сведения у GitHub собирает workflow (facts.json), решает
// этот модуль: так каждое правило проверяется тестом.

import { z } from "zod";

/** PR ветки auto/{набор} — из REST API GitHub (`pulls?head=владелец:ветка&state=all`). */
export const prFactSchema = z.strictObject({
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
  /** Метки версии из описания — скрытые комментарии `<!-- iconavo-bot:… -->` (pr.ts). */
  markers: z.array(z.string()),
  /** Репозиторий ветки PR, `owner/repo`; null — репозиторий удалён. */
  headRepo: z.string().nullable(),
  headSha: z.string(),
});

export const factsSchema = z.strictObject({
  /** Репозиторий робота, `owner/repo`. */
  repo: z.string().min(1),
  /** Последняя версия источника — не та, что в main. */
  changed: z.boolean(),
  prs: z.array(prFactSchema),
  /** Кто закрыл PR без слияния (`closed_by` у GitHub): номер PR → логин; null — неизвестно. */
  closedBy: z.record(z.string(), z.string().nullable()),
  /** Ветка auto/{набор} в репозитории: последний коммит и его автор; ветки нет — null. */
  branch: z.strictObject({ sha: z.string(), author: z.string() }).nullable(),
});

export type PrFact = z.infer<typeof prFactSchema>;
export type Facts = z.infer<typeof factsSchema>;

/**
 * build — собрать и открыть или обновить PR; hands-off — PR правят руками; rejected — PR этой версии
 * закрыли без слияния; close — в main уже последняя версия; none — делать нечего; stop — остановиться:
 * в ветке робота чужой коммит, которому нет объяснения.
 */
export type RobotAction =
  | "build"
  | "hands-off"
  | "rejected"
  | "close"
  | "none"
  | "stop";

export interface RobotState {
  action: RobotAction;
  /** Открытый PR робота. */
  open?: number;
  /** PR этой версии, закрытый без слияния человеком. */
  rejected?: number;
  /** Почему робот остановился (stop). */
  problem?: string;
}

/**
 * Метка версии сравнивается целиком, со скрытым комментарием вокруг: `<!-- iconavo-bot:ph@2.1.1 -->`
 * не совпадает с меткой `ph@2.1.10`.
 */
export const hasMarker = (markers: readonly string[], marker: string) =>
  markers.includes(`<!-- ${marker} -->`);

/** Коммит или действие приложения GitHub: у него имя вида `iconavo-bot[bot]`. */
export const isBot = (name: string | null | undefined) =>
  name?.endsWith("[bot]") === true;

/**
 * Правила ADR-0019. Свои PR — только из веток этого репозитория: PR из чужой копии с той же веткой —
 * не наш, сколько бы их ни было. PR, закрытый самим роботом, — не отказ владельца. Ветку с коммитом
 * человека робот не перезаписывает: при открытом PR — не трогает, без него — останавливается, если
 * коммит не последний у закрытого PR (тот и так остался в истории PR на GitHub).
 */
export function robotState(
  facts: Facts,
  marker: string,
  branchName: string,
): RobotState {
  const mine = facts.prs.filter((p) => p.headRepo === facts.repo);
  const open = mine.find((p) => p.state === "open");
  const opened = open === undefined ? {} : { open: open.number };
  const { branch } = facts;
  const botTip = branch !== null && isBot(branch.author);

  if (!facts.changed) {
    return {
      action: open !== undefined && botTip ? "close" : "none",
      ...opened,
    };
  }
  if (open !== undefined) {
    return { action: botTip ? "build" : "hands-off", ...opened };
  }
  // Кто закрыл, неизвестно, — считается отказом: решение владельца важнее.
  const rejected = mine.find(
    (p) =>
      p.state === "closed" &&
      !p.merged &&
      hasMarker(p.markers, marker) &&
      !isBot(facts.closedBy[String(p.number)]),
  );
  if (rejected !== undefined) {
    return { action: "rejected", rejected: rejected.number };
  }
  if (
    branch !== null &&
    !botTip &&
    !mine.some((p) => p.state === "closed" && p.headSha === branch.sha)
  ) {
    return {
      action: "stop",
      problem: `в ветке ${branchName} последний коммит — ${branch.author}, а открытого PR нет: робот её не перезаписывает. Откройте PR из этой ветки или удалите её — робот соберёт ветку заново.`,
    };
  }
  return { action: "build" };
}
