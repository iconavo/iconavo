// Отчёт проверки MCP в Claude Code (шаг 12 фазы 4): таблица «сценарий × признаки» в терминале и
// Markdown с подробностями — запрос, ответ номером, вызванные инструменты, иконки, ответ ассистента.

import type { Verdict } from "../sandbox/verdict.js";
import {
  type ClientsReport,
  CRITERIA,
  CRITERION_TITLES,
  type ScenarioResult,
} from "./clients.js";
import type { LimitsReport } from "./clients-limits.js";

const GROUP_TITLES: Record<ScenarioResult["group"], string> = {
  find: "найти",
  code: "код",
  set: "набор",
  license: "лицензии",
};

const cell = (v: Verdict | undefined) =>
  v === undefined ? "—" : v.ok === true ? "да" : v.ok === false ? "НЕТ" : "?";

const total = (r: ScenarioResult) =>
  r.setup.length > 0 ? "сбой" : r.passed ? "да" : "НЕТ";

export function countPassed(results: readonly ScenarioResult[]) {
  const counted = results.filter((r) => r.setup.length === 0);
  return {
    passed: counted.filter((r) => r.passed).length,
    counted: counted.length,
    setup: results.length - counted.length,
  };
}

export function formatClients(report: ClientsReport): string[] {
  const head = [
    "№",
    "Язык",
    "Группа",
    ...CRITERIA.map((c) => CRITERION_TITLES[c]),
    "Итог",
  ];
  const rows = report.results.map((r) => [
    String(r.id),
    r.lang,
    GROUP_TITLES[r.group],
    ...CRITERIA.map((c) => cell(r.verdicts[c])),
    total(r),
  ]);
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const line = (row: string[]) =>
    row.map((x, i) => x.padEnd(widths[i] ?? 0)).join("  ");
  const { passed, counted, setup } = countPassed(report.results);
  const problems = report.results.flatMap((r) => [
    ...r.setup.map((p) => `${r.id}: сбой настройки — ${p}`),
    ...CRITERIA.filter((c) => r.verdicts[c]?.ok === false).map(
      (c) => `${r.id}: ${CRITERION_TITLES[c]} — ${r.verdicts[c]?.note}`,
    ),
    ...r.problems.map((p) => `${r.id}: ${p}`),
  ]);
  return [
    line(head),
    ...rows.map(line),
    "",
    ...(problems.length === 0
      ? []
      : ["Не так:", ...problems.map((p) => `  ${p}`), ""]),
    `Засчитано: ${passed} из ${counted}${setup > 0 ? `, сбоев настройки — ${setup}` : ""}${report.stoppedBySubscription ? "; прогон остановлен лимитом подписки" : ""}.`,
  ];
}

const quote = (text: string, limit = 1200) =>
  (text.length > limit ? `${text.slice(0, limit)}…` : text)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

export function markdownClients(
  report: ClientsReport,
  limits?: LimitsReport,
): string {
  const { passed, counted, setup } = countPassed(report.results);
  const table = [
    `| № | Язык | Группа | ${CRITERIA.map((c) => CRITERION_TITLES[c]).join(" | ")} | Итог |`,
    `|---|---|---|${CRITERIA.map(() => "---").join("|")}|---|`,
    ...report.results.map(
      (r) =>
        `| ${r.id} | ${r.lang} | ${GROUP_TITLES[r.group]} | ${CRITERIA.map((c) => cell(r.verdicts[c])).join(" | ")} | ${total(r)} |`,
    ),
  ];
  const details = report.results.map((r) =>
    [
      `### ${r.id}. ${r.prompt}`,
      "",
      `- Итог: **${total(r)}**${r.followUp === undefined ? "" : `; второе сообщение человека — «${r.followUp}»`}`,
      `- Инструменты: ${r.tools.length === 0 ? "нет" : r.tools.join(" → ")}`,
      `- Иконки: ${r.icons.length === 0 ? "нет" : r.icons.join(", ")}`,
      ...CRITERIA.filter((c) => r.verdicts[c] !== undefined).map(
        (c) =>
          `- ${CRITERION_TITLES[c]}: ${cell(r.verdicts[c])} — ${r.verdicts[c]?.note}`,
      ),
      ...(r.setup.length === 0
        ? []
        : [`- Сбой настройки: ${r.setup.join("; ")}`]),
      ...(r.problems.length === 0 ? [] : [`- Сбои: ${r.problems.join("; ")}`]),
      ...(r.files.length === 0 ? [] : [`- Файлы: ${r.files.join(", ")}`]),
      `- Ходов: ${r.turns}, ${Math.round(r.durationMs / 1000)} с, оценка стоимости $${r.costUsd.toFixed(3)}`,
      "",
      quote(r.answer),
      "",
    ].join("\n"),
  );
  const limitsPart =
    limits === undefined
      ? []
      : [
          "## Лимиты",
          "",
          `- Счётчик: ${cell(limits.verdicts.trip)} — ${limits.verdicts.trip.note}`,
          `- Ассистент: ${cell(limits.verdicts.assistant)} — ${limits.verdicts.assistant.note}`,
          `- После паузы: ${cell(limits.verdicts.recovery)} — ${limits.verdicts.recovery.note}`,
          "",
          ...(limits.answer === "" ? [] : [quote(limits.answer, 800), ""]),
        ];
  return [
    "# Проверка MCP в Claude Code",
    "",
    `Модель ${report.model}, Claude Code ${report.version || "?"}, сервер — сборка ${report.build}, начало ${report.startedAt}.`,
    "",
    `**Засчитано: ${passed} из ${counted}**${setup > 0 ? `, сбоев настройки — ${setup}` : ""}${report.stoppedBySubscription ? "; прогон остановлен лимитом подписки" : ""}.`,
    "",
    ...table,
    "",
    ...limitsPart,
    "## Сценарии",
    "",
    ...details,
  ].join("\n");
}
