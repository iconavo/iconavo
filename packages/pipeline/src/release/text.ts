// Тексты, которые меняет выпуск (ADR-0051): строка подключения скрипта тега — адрес jsDelivr с версией
// и хэш integrity (SRI, ADR-0032), — и журнал изменений трёх пакетов. Чистые функции: команды выпуска
// читают и пишут файлы, а здесь только разбор и замена текста.

import { createHash } from "node:crypto";
import { compareVersions, parseVersion } from "../sources/version.js";
import { SCRIPT_PATH, scriptUrl } from "./config.js";

/** Хэш для integrity: SHA-384 в base64, как у jsDelivr. */
export const sri = (bytes: Uint8Array | string) =>
  `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

/** Верный вид хэша: 48 байт SHA-384 — ровно 64 знака base64 без «=». */
export const SRI_FORMAT = /^sha384-[A-Za-z0-9+/]{64}$/;

const escaped = SCRIPT_PATH.replaceAll(".", "\\.").replaceAll("/", "\\/");
/** Адрес скрипта на jsDelivr с любой версией: в строке <script> и в import рецепта configure. */
const SCRIPT_URL = new RegExp(
  `https:\\/\\/cdn\\.jsdelivr\\.net\\/npm\\/@iconavo-ui\\/icon@([^/"'\\s]+)\\/${escaped}`,
  "g",
);
/** Строка подключения: модульный скрипт с этим адресом и атрибутами после него. */
const SCRIPT_TAG = new RegExp(
  `<script type="module" src="(${SCRIPT_URL.source})"([^>]*)><\\/script>`,
  "g",
);
const INTEGRITY = /\sintegrity="([^"]*)"/;

export interface ScriptRefs {
  /** Версии во всех адресах скрипта, по порядку. */
  versions: string[];
  /** Строки подключения: версия и хэш, если он есть. */
  tags: { version: string; integrity?: string; attributes: string }[];
}

export function scriptRefs(text: string): ScriptRefs {
  return {
    versions: [...text.matchAll(SCRIPT_URL)].map((m) => m[1] as string),
    tags: [...text.matchAll(SCRIPT_TAG)].map((m) => {
      const attributes = (m[3] as string).trim();
      const integrity = INTEGRITY.exec(` ${attributes}`)?.[1];
      return {
        version: m[2] as string,
        attributes,
        ...(integrity === undefined ? {} : { integrity }),
      };
    }),
  };
}

/**
 * Версия во всех адресах скрипта и хэш в каждой строке подключения. Строка приводится к одному виду:
 * src и integrity, без crossorigin — модульный скрипт браузер и так загружает без cookies.
 */
export function setScriptRefs(
  text: string,
  version: string,
  integrity: string,
): string {
  const url = scriptUrl(version);
  return text
    .replace(
      SCRIPT_TAG,
      () =>
        `<script type="module" src="${url}" integrity="${integrity}"></script>`,
    )
    .replace(SCRIPT_URL, url);
}

/** Раздел журнала: «## 0.1.0 — 2026-10-30». */
const SECTION = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/;
/** Заготовка, которую оставляет pnpm release bump: с ней выпуск не идёт. */
export const TODO = "TODO";

export interface ChangelogSection {
  version: string;
  date: string;
  /** Текст раздела без заголовка. */
  body: string;
}

/** Разделы журнала по порядку; заголовки «##» не того вида — в bad. */
export function changelogSections(text: string): {
  sections: ChangelogSection[];
  bad: string[];
} {
  const sections: ChangelogSection[] = [];
  const bad: string[] = [];
  let current: ChangelogSection | undefined;
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("```")) fence = !fence;
    if (!fence && line.startsWith("## ")) {
      const m = SECTION.exec(line);
      if (m) {
        current = { version: m[1] as string, date: m[2] as string, body: "" };
        sections.push(current);
      } else {
        bad.push(line);
        current = undefined;
      }
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  for (const s of sections) s.body = s.body.trim();
  return { sections, bad };
}

/**
 * Новый раздел журнала с заготовкой — перед первым разделом, после вступления. Раздел этой версии уже
 * первый — меняется только дата: например, когда выпуск сливают на следующий день.
 */
export function addChangelogSection(
  text: string,
  version: string,
  date: string,
): string {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.startsWith("## "));
  if (first !== -1 && SECTION.exec(lines[first] as string)?.[1] === version) {
    lines[first] = `## ${version} — ${date}`;
    return lines.join("\n");
  }
  const section = [`## ${version} — ${date}`, "", `- ${TODO}`, ""];
  if (first === -1) {
    const body = text.replace(/\s*$/, "");
    return `${body}\n\n${section.join("\n")}`;
  }
  lines.splice(first, 0, ...section);
  return lines.join("\n");
}

const isDate = (date: string) =>
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);

/** Что не так с журналом для выпуска этой версии; пустой список — всё на месте. */
export function changelogProblems(text: string, version: string): string[] {
  const { sections, bad } = changelogSections(text);
  const problems = bad.map(
    (line) => `журнал: заголовок «${line}» — нужен вид «## X.Y.Z — ГГГГ-ММ-ДД»`,
  );
  const top = sections[0];
  if (top === undefined) {
    problems.push(
      `журнал: нет раздела ${version} — pnpm release bump ${version}`,
    );
    return problems;
  }
  if (top.version !== version) {
    problems.push(
      `журнал: первый раздел — ${top.version}, а версия пакетов — ${version}`,
    );
  }
  const own = sections.find((s) => s.version === version);
  if (own !== undefined) {
    if (own.body === "") problems.push(`журнал: раздел ${version} пуст`);
    if (own.body.includes(TODO)) {
      problems.push(
        `журнал: в разделе ${version} осталась заготовка ${TODO} — допишите, что изменилось`,
      );
    }
  }
  for (const s of sections) {
    if (!isDate(s.date)) {
      problems.push(`журнал: у раздела ${s.version} неверная дата ${s.date}`);
    }
  }
  const versions = sections.map((s) => s.version);
  if (new Set(versions).size !== versions.length) {
    problems.push("журнал: одна версия — в нескольких разделах");
  }
  const order = (v: string) => parseVersion(v) ?? [];
  if (
    versions.some(
      (v, i) =>
        i > 0 &&
        compareVersions(order(v), order(versions[i - 1] as string)) >= 0,
    )
  ) {
    problems.push("журнал: разделы — не от новой версии к старой");
  }
  return problems;
}
