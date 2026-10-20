// Текст PR робота обновления наборов (ADR-0019): заголовок, метки и описание — из сводки сборки
// (summary.json), записи набора в sources.lock.json до обновления и ссылок на отчёты запуска.

import { groupDigits, releaseSection } from "../changelog/journal.js";
import { CHANGED_PIXELS } from "../qc/config.js";
import { share } from "../qc/run.js";
import { LICENSE_TITLES, type SourceConfig } from "../sources/config.js";
import type { LockEntry } from "../sources/lock.js";
import { type Decision, decide, type Verdict } from "./decide.js";
import type { AttentionKind, SetSummary } from "./summary.js";

/** Метки PR робота: все его PR; ждёт владельца; сборка остановилась. */
export const PR_LABELS = {
  bot: "автообновление",
  approval: "нужно одобрение",
  problem: "проблема",
} as const;

/** Предел описания PR с запасом: GitHub принимает до 65 536 символов. */
export const BODY_LIMIT = 60_000;

/** Сколько находок контроля и исключённых иконок перечислять в описании; остальные — в отчёте. */
export const ATTENTION_LIMIT = 30;

export interface PrLinks {
  /** Страница запуска робота. */
  run?: string;
  /** Страницы отчёта, которые открываются в браузере. */
  changelog?: string;
  qc?: string;
  metadata?: string;
  /** Архив всех страниц отчёта. */
  reports?: string;
}

export interface PrInput {
  config: SourceConfig;
  summary: SetSummary;
  /** Запись набора в sources.lock.json в main; нет — набора там ещё нет. */
  before?: LockEntry;
  /** Коммит → тег выпуска: имена версий git-источников. */
  tags?: ReadonlyMap<string, string>;
  links?: PrLinks;
  /** false — автослияние не включать, даже если можно: PR ждёт владельца. По умолчанию — можно. */
  autoMerge?: boolean;
}

export interface PrText {
  decision: Decision;
  /** Коротко, для итога запуска: «сольётся сам», «ждёт одобрения», «проблема». */
  verdict: string;
  /** Включать ли автослияние. */
  autoMerge: boolean;
  reasons: string[];
  title: string;
  labels: string[];
  /** Метка версии в начале описания: по ней робот узнаёт версию, PR которой закрыли без слияния. */
  marker: string;
  body: string;
  /** Текст коммита при автослиянии: короткий, без описания PR. */
  commitBody: string;
}

/** Метка версии: `iconavo-bot:lucide@{коммит}`, `iconavo-bot:tabler@3.50.0`. */
export const prMarker = (id: string, e: LockEntry) =>
  `iconavo-bot:${id}@${e.type === "npm" ? e.version : e.commit}`;

/** Версия для людей: тег выпуска, версия пакета или первые 7 символов коммита. */
export function revisionName(
  e: LockEntry,
  tags?: ReadonlyMap<string, string>,
): string {
  if (e.type === "npm") return e.version;
  return tags?.get(e.commit) ?? e.commit.slice(0, 7);
}

/** «@» без упоминаний: иначе `@tabler/icons` в тексте позвал бы чужую организацию на GitHub. */
const safe = (text: string) => text.replaceAll("@", "@​");
const code = (text: string) => `\`${text}\``;
const section = (title: string, lines: readonly string[]) =>
  [`### ${title}`, "", ...lines].join("\n");

const KIND_NAMES: Record<AttentionKind, string> = {
  sparse: "почти пустая",
  cropped: "обрезана",
  original: "отличается от оригинала",
};

/** «добавлено 8, изменено 3» — только ненулевые. */
function countsText(c: SetSummary["release"]["changes"]): string {
  const items: [number, string][] = [
    [c.added, "добавлено"],
    [c.changed, "изменено"],
    [c.restored, "вернулось"],
    [c.hidden, "скрыто"],
    [c.renamed, "переименовано"],
    [c.aliases, "новые алиасы"],
  ];
  return items
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${what} ${groupDigits(n)}`)
    .join(", ");
}

/** Список с пределом: «… и ещё 12 — в отчёте». */
function limited(lines: readonly string[]): string[] {
  return lines.length > ATTENTION_LIMIT
    ? [
        ...lines.slice(0, ATTENTION_LIMIT),
        `- … и ещё ${groupDigits(lines.length - ATTENTION_LIMIT)} — в отчёте`,
      ]
    : [...lines];
}

function verdictBlock(s: SetSummary, v: Verdict, autoMerge: boolean): string {
  const list = v.reasons.map((r) => `- ${safe(r)}`);
  if (v.decision === "problem") {
    return [
      "**Проблема: сборка остановилась** — слить нельзя. В PR только `sources.lock.json`: файлы набора не записаны.",
      "",
      ...list,
    ].join("\n");
  }
  if (v.decision === "approval") {
    return [
      "**Ждёт вашего одобрения:**",
      "",
      ...list,
      ...(v.licenseOnly
        ? [
            "",
            "В PR пока только `sources.lock.json`: файлы набора запишутся после подтверждения лицензии, до этого проверка «Данные» красная.",
          ]
        : []),
    ].join("\n");
  }
  if (!autoMerge) {
    return "**Ждёт вас**: обновление безопасное, но автослияние для этого запуска выключено. Слейте сами, когда пройдут проверки «CI» и «Данные».";
  }
  return s.release.status === "same"
    ? "**Сольётся сам**, когда пройдут проверки «CI» и «Данные»: рисунки и имена иконок не изменились, обновилась только версия источника."
    : "**Сольётся сам**, когда пройдут проверки «CI» и «Данные»: иконки только добавлены или изменены.";
}

function sourceLine(input: PrInput, from: string | undefined, to: string) {
  const { config, summary: s, before, tags } = input;
  const versions =
    from === undefined ? code(to) : `${code(from)} → ${code(to)}`;
  const parts = [`${config.name} ${versions}`];
  if (config.source.type === "git" && s.entry.type === "git") {
    const repo = config.source.repo.replace(/\.git$/, "");
    if (repo.startsWith("https://github.com/")) {
      const tag = tags?.get(s.entry.commit);
      if (tag) {
        parts.push(
          `[выпуск ${tag} у автора](${repo}/releases/tag/${encodeURIComponent(tag)})`,
        );
      }
      parts.push(
        before?.type === "git"
          ? `[изменения в источнике](${repo}/compare/${before.commit}...${s.entry.commit})`
          : `[коммит у автора](${repo}/commit/${s.entry.commit})`,
      );
    }
  } else if (config.source.type === "npm" && s.entry.type === "npm") {
    const pkg = config.source.package;
    parts.push(
      `пакет [${code(`${pkg}@${s.entry.version}`)}](https://www.npmjs.com/package/${pkg}/v/${s.entry.version})`,
    );
  }
  return parts.join(" · ");
}

function todo(config: SourceConfig, s: SetSummary, v: Verdict, auto: boolean) {
  if (v.decision === "problem") {
    return s.qc.counts.empty + s.qc.counts.failed > 0
      ? "Откройте отчёт «Контроль качества»: там пустые или ненарисованные иконки. Обычно это ошибка у автора — закройте PR и дождитесь следующей версии. Если обновление нужно сейчас, попросите Claude разобраться."
      : "Попросите Claude разобраться с причиной выше. Если нужна правка конвейера или конфига, она идёт отдельным PR в main, а этот PR робот пересоберёт сам на следующий день.";
  }
  if (v.licenseOnly) {
    return `Прочитайте текст лицензии в отчёте «Лицензия и теги». Согласны — напишите Claude: «подтверждаю лицензию ${config.name} из PR робота». Он впишет отпечаток в \`sources/${config.id}.ts\` прямо в ветку этого PR и пересоберёт \`data/\`; после этого робот ветку не трогает, сливаете вы. Не согласны — закройте PR.`;
  }
  if (v.decision === "approval") {
    return "Посмотрите отчёты ниже — прежде всего «Что изменилось». Согласны — «Squash and merge». Нет — закройте PR: эту версию робот больше не предложит (передумаете — Reopen).";
  }
  return auto
    ? "Ничего. Если с обновлением что-то не так, закройте PR: эту версию робот больше не предложит, а следующую — предложит."
    : "Посмотрите отчёты ниже и нажмите «Squash and merge», когда проверки станут зелёными. Не согласны — закройте PR: эту версию робот больше не предложит.";
}

function journal(s: SetSummary): string {
  const top = s.release.top;
  if (s.release.status === "same" || !top) {
    return section("Журнал", [
      "Рисунки и имена иконок не изменились — нового выпуска в журнале нет. Изменилась только версия источника, а с ней, может быть, теги и категории.",
    ]);
  }
  return section("Журнал", [
    ...(s.written
      ? []
      : ["Так выглядел бы выпуск, если бы сборка прошла:", ""]),
    safe(releaseSection(top).replace(/^## /, "#### ")),
  ]);
}

function quality(id: string, s: SetSummary): string {
  const c = s.qc.counts;
  const lines = [
    `Нарисовано ${groupDigits(s.qc.checked)}: пустых ${c.empty} · почти пустых ${c.sparse} · обрезанных ${c.cropped} · отличаются от оригинала ${c.original} · заметно изменились (больше ${share(CHANGED_PIXELS)} пикселей) ${c.changed}${c.failed > 0 ? ` · не нарисованы ${c.failed}` : ""}.`,
    "",
  ];
  if (s.qc.attention.length === 0) {
    lines.push("Новых находок у добавленных и изменённых иконок нет.");
  } else {
    lines.push(
      "Новые находки — у добавленных и изменённых иконок:",
      "",
      ...limited(
        s.qc.attention.map(
          (f) =>
            `- ${code(`${id}:${f.name}`)} — ${KIND_NAMES[f.kind]}: ${safe(f.text)}`,
        ),
      ),
    );
  }
  if (s.excluded.length > 0) {
    lines.push(
      "",
      "Исключены при очистке — у автора они есть, а в наборе их не будет:",
      "",
      ...limited(
        s.excluded.map(
          (e) => `- ${code(`${id}:${e.name}`)} — ${safe(e.reason)}`,
        ),
      ),
    );
  }
  return section("Контроль качества", lines);
}

function license(config: SourceConfig, s: SetSummary): string {
  const title = LICENSE_TITLES[config.license.spdx];
  const { status, hash } = s.license;
  return section("Лицензия", [
    status === "confirmed"
      ? `${title} — текст тот же, что вы подтвердили.`
      : status === "changed"
        ? `${title} — текст изменился у автора: нужно ваше подтверждение. Новый отпечаток: ${code(`${(hash ?? "").slice(0, 12)}…`)}.`
        : status === "unconfirmed"
          ? `${title} — текст ещё не подтверждён.`
          : `${title} — текст лицензии не прочитан, причина — выше.`,
  ]);
}

function reports(links: PrLinks): string | undefined {
  const pages = [
    links.changelog && `- [Что изменилось, с картинками](${links.changelog})`,
    links.qc && `- [Контроль качества](${links.qc})`,
    links.metadata && `- [Лицензия и теги](${links.metadata})`,
    links.reports && `- [Все страницы отчёта — архив](${links.reports})`,
  ].filter((line): line is string => typeof line === "string" && line !== "");
  const run = links.run ? [`- [Запуск робота](${links.run})`] : [];
  if (pages.length + run.length === 0) return undefined;
  return section("Отчёты", [
    ...(pages.length > 0
      ? [
          "Страницы открываются в браузере, если вы вошли в GitHub, и хранятся 90 дней. Вкладку «Files changed» смотреть не обязательно: там данные для машины.",
          "",
        ]
      : []),
    ...pages,
    ...run,
  ]);
}

const FOOTER =
  "---\n\nPR открыл робот обновления наборов (ADR-0019). Пока PR открыт, робот раз в сутки пересобирает его от свежего main. Если отправить в ветку свой коммит, робот её больше не трогает.";

/** Заголовок, метки и описание PR набора; решение — decide. */
export function prText(input: PrInput): PrText {
  const { config, summary: s, before, tags, links = {} } = input;
  const v = decide(s, before, tags);
  const autoMerge = v.decision === "auto" && input.autoMerge !== false;
  const from = before && revisionName(before, tags);
  const to = revisionName(s.entry, tags);
  const counts = countsText(s.release.changes);
  const what =
    v.decision === "problem"
      ? "сборка остановилась"
      : v.licenseOnly
        ? ["новая лицензия", counts].filter((t) => t !== "").join(", ")
        : counts || "иконки не изменились";
  const title = `${config.name} ${from === undefined ? to : `${from} → ${to}`}: ${what}`;
  const marker = prMarker(config.id, s.entry);

  const head = [
    `<!-- ${marker} -->`,
    verdictBlock(s, v, autoMerge),
    sourceLine(input, from, to),
  ].join("\n\n");
  const tail = [
    quality(config.id, s),
    license(config, s),
    reports(links),
    FOOTER,
  ].filter((part) => part !== undefined);
  const assemble = (log: string) =>
    `${[head, section("Что делать", [todo(config, s, v, autoMerge)]), log, ...tail].join("\n\n")}\n`;
  let body = assemble(journal(s));
  if (body.length > BODY_LIMIT) {
    body = assemble(
      section("Журнал", [
        `Выпуск большой и в описание не поместился — смотрите ${links.changelog ? `[что изменилось](${links.changelog})` : "отчёт «Что изменилось»"} или \`data/${config.id}/CHANGELOG.md\` в ветке PR.`,
      ]),
    );
  }
  if (body.length > BODY_LIMIT) {
    body = `${body.slice(0, BODY_LIMIT)}\n\n… описание обрезано: полный текст — в отчётах запуска.\n`;
  }

  return {
    decision: v.decision,
    verdict:
      v.decision === "problem"
        ? "проблема"
        : v.decision === "approval"
          ? "ждёт одобрения"
          : autoMerge
            ? "сольётся сам"
            : "ждёт вас: автослияние выключено",
    autoMerge,
    reasons: v.reasons,
    title,
    labels: [
      PR_LABELS.bot,
      ...(v.decision === "approval"
        ? [PR_LABELS.approval]
        : v.decision === "problem"
          ? [PR_LABELS.problem]
          : []),
    ],
    marker,
    body,
    commitBody: `Автообновление (ADR-0019): sources.lock.json и data/${config.id}/. Журнал — data/${config.id}/CHANGELOG.md.`,
  };
}
