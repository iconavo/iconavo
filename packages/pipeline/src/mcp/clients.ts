// Проверка MCP-сервера в Claude Code (шаг 12 фазы 4, ADR-0044): каждый сценарий — свежий `claude -p` в
// чистой папке вне репозитория (иначе Claude Code прочитал бы наш CLAUDE.md), только с нашим сервером,
// без настроек, плагинов, памяти и коннекторов владельца; события — потоком stream-json. По событиям и
// файлам папки — признаки сценария (clients-scenarios.ts); проекты HTML и React ещё собираются и
// открываются в Chrome: иконки нарисованы. «Найти» без сетки: ассистент показывает список с номерами —
// прогон отвечает номером подходящей иконки вторым сообщением. Только локально: нужен вход в Claude Code.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import type { Style } from "@iconavo-ui/search";
import type { Browser } from "playwright";
import { stopTree } from "../example/next.js";
import { launchBrowser } from "../sandbox/browser.js";
import { fail, pass, type Verdict } from "../sandbox/verdict.js";
import { drawnVerdict, waitDrawn } from "../starters/check.js";
import { run } from "../starters/pack.js";
import { startStatic } from "../starters/servers.js";
import type {
  ClientScenario,
  CodeKind,
  ProjectKind,
  SetRule,
} from "./clients-scenarios.js";
import { MCP_ORIGIN, MCP_PATH } from "./config.js";

/** Модель первого прогона; итоговый — модель по умолчанию у подписки (план шага 12). */
export const DEFAULT_MODEL = "sonnet";
/** Усилия — как у большинства пользователей, а не максимальные из настроек владельца. */
export const EFFORT = "medium";
/** Сценарий целиком, с ответом номером и сборкой проекта. */
export const SCENARIO_TIMEOUT_MS = 8 * 60_000;
export const MAX_TURNS = 25;
/** Ждать иконки на странице проекта. */
const DRAW_TIMEOUT_MS = 30_000;

export const PREFIXES = [
  "lucide",
  "tabler",
  "material-symbols",
  "ph",
  "fluent-emoji-flat",
] as const;

// ---------------------------------------------------------------------------------------------------
// Запуск claude -p

/**
 * Окружение прогона: без переменных Claude Code и Anthropic этой сессии. Иначе вложенный запуск взял
 * бы максимальные усилия из настроек владельца (CLAUDE_CODE_EFFORT_LEVEL перебивает --effort), а ключ
 * API — вместо подписки. Папку настроек не трогаем: там вход по подписке. Поверх — выключатели памяти,
 * CLAUDE.md, коннекторов claude.ai, фоновых задач и самообновления.
 */
export function cleanEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(CLAUDE|ANTHROPIC_)/.test(key) && key !== "CLAUDE_CONFIG_DIR") {
      continue;
    }
    out[key] = value;
  }
  return {
    ...out,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    DISABLE_AUTOUPDATER: "1",
    BASH_DEFAULT_TIMEOUT_MS: "300000",
  };
}

/** Аргументы claude: запрос — стандартным вводом, настройки MCP — файлом. */
export function claudeArgs(model: string, mcpConfig: string): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--effort",
    EFFORT,
    "--max-turns",
    String(MAX_TURNS),
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfig,
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--tools",
    "Read,Edit,Write,Glob,Grep,Bash,ToolSearch",
    "--allowedTools",
    "mcp__iconavo__*",
    "Bash(npm install *)",
    "Bash(npm i *)",
    "Bash(npm run build *)",
  ];
}

/** claude.exe из PATH: на Windows spawn без оболочки не знает PATHEXT. */
export function findClaude(env: NodeJS.ProcessEnv = process.env): string {
  const file = process.platform === "win32" ? "claude.exe" : "claude";
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    const path = join(dir, file);
    if (dir !== "" && existsSync(path)) return path;
  }
  throw new Error(
    "claude не найден в PATH: нужен установленный Claude Code с входом по подписке",
  );
}

export const userMessage = (text: string): string =>
  `${JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  })}\n`;

// ---------------------------------------------------------------------------------------------------
// События stream-json

export interface InitInfo {
  model: string;
  apiKeySource: string;
  version: string;
  mcp: { name: string; status: string }[];
  plugins: { name: string; path: string }[];
  tools: string[];
}

export interface ToolCall {
  id: string;
  /** Имя инструмента нашего сервера без mcp__iconavo__ или встроенного (Bash, Write…). */
  name: string;
  mcp: boolean;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  isError: boolean;
  text: string;
}

export interface TurnEnd {
  subtype: string;
  isError: boolean;
  text: string;
  turns: number;
  durationMs: number;
  costUsd: number;
}

export interface Transcript {
  init?: InitInfo;
  calls: ToolCall[];
  results: ToolResult[];
  /** Текст ассистента в основном потоке — по порядку. */
  texts: string[];
  ends: TurnEnd[];
  /** Отказы в правах и сбои: время вышло, лимит подписки, ошибки разбора. */
  problems: string[];
  /** Подписка упёрлась в свой лимит: дальше не гнать. */
  subscriptionLimited: boolean;
}

export const emptyTranscript = (): Transcript => ({
  calls: [],
  results: [],
  texts: [],
  ends: [],
  problems: [],
  subscriptionLimited: false,
});

const MCP_PREFIX = "mcp__iconavo__";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

/** Текст результата инструмента: строка или блоки text (картинки и ссылки пропускаем). */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is Json => isObject(b) && b.type === "text")
    .map((b) => str(b.text))
    .join("\n");
}

/** Одно событие stream-json — в разбор. Подагенты (parent_tool_use_id) не считаем. */
export function applyEvent(t: Transcript, e: unknown): void {
  if (!isObject(e)) return;
  if (e.parent_tool_use_id !== undefined && e.parent_tool_use_id !== null) {
    return;
  }
  if (e.type === "system" && e.subtype === "init") {
    t.init = {
      model: str(e.model),
      apiKeySource: str(e.apiKeySource),
      version: str(e.claude_code_version),
      mcp: (Array.isArray(e.mcp_servers) ? e.mcp_servers : [])
        .filter(isObject)
        .map((s) => ({ name: str(s.name), status: str(s.status) })),
      plugins: (Array.isArray(e.plugins) ? e.plugins : [])
        .filter(isObject)
        .map((p) => ({ name: str(p.name), path: str(p.path) })),
      tools: (Array.isArray(e.tools) ? e.tools : []).map(str),
    };
    return;
  }
  if (e.type === "system" && e.subtype === "permission_denied") {
    t.problems.push(`отказ в правах: ${JSON.stringify(e).slice(0, 200)}`);
    return;
  }
  if (e.type === "rate_limit_event") {
    const info = isObject(e.rate_limit_info) ? e.rate_limit_info : {};
    if (info.status === "rejected") {
      t.subscriptionLimited = true;
      t.problems.push("лимит подписки Claude Code");
    }
    return;
  }
  const message = isObject(e.message) ? e.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : [];
  if (e.type === "assistant") {
    for (const block of content.filter(isObject)) {
      if (block.type === "text" && str(block.text).trim() !== "") {
        t.texts.push(str(block.text));
      }
      if (block.type === "tool_use") {
        const name = str(block.name);
        if (name === "ToolSearch") continue;
        const id = str(block.id);
        if (t.calls.some((c) => c.id === id)) continue;
        t.calls.push({
          id,
          name: name.startsWith(MCP_PREFIX)
            ? name.slice(MCP_PREFIX.length)
            : name,
          mcp: name.startsWith(MCP_PREFIX),
          input: isObject(block.input) ? block.input : {},
        });
      }
    }
    return;
  }
  if (e.type === "user") {
    for (const block of content.filter(isObject)) {
      if (block.type !== "tool_result") continue;
      const id = str(block.tool_use_id);
      const call = t.calls.find((c) => c.id === id);
      if (call === undefined) continue;
      t.results.push({
        id,
        name: call.name,
        isError: block.is_error === true,
        text: resultText(block.content),
      });
    }
    return;
  }
  if (e.type === "result") {
    t.ends.push({
      subtype: str(e.subtype),
      isError: e.is_error === true,
      text: str(e.result),
      turns: num(e.num_turns),
      durationMs: num(e.duration_ms),
      costUsd: num(e.total_cost_usd),
    });
  }
}

/**
 * Прогон — «как у обычного пользователя»: вход по подписке, подключён ровно наш сервер, плагины —
 * только встроенные в Claude Code, чужих инструментов MCP нет. Иначе — сбой настройки, а не ошибка
 * ассистента.
 */
export function setupProblems(init: InitInfo | undefined): string[] {
  if (init === undefined) return ["нет события запуска"];
  const problems: string[] = [];
  if (init.apiKeySource !== "none") {
    problems.push(`вход не по подписке: ${init.apiKeySource}`);
  }
  const servers = init.mcp.map((s) => `${s.name}:${s.status}`);
  if (servers.join() !== "iconavo:connected") {
    problems.push(`серверы MCP: ${servers.join(", ") || "нет"}`);
  }
  const plugins = init.plugins.filter((p) => p.path !== "builtin");
  if (plugins.length > 0) {
    problems.push(`плагины: ${plugins.map((p) => p.name).join(", ")}`);
  }
  const foreign = init.tools.filter(
    (tool) => tool.startsWith("mcp__") && !tool.startsWith(MCP_PREFIX),
  );
  if (foreign.length > 0) {
    problems.push(`чужие инструменты MCP: ${foreign.join(", ")}`);
  }
  return problems;
}

export interface ClaudeRun {
  cwd: string;
  prompt: string;
  model: string;
  mcpConfig: string;
  /** После первого ответа: второе сообщение человека или undefined — закончить. */
  followUp?: (t: Transcript) => string | undefined;
  timeoutMs?: number;
  exe?: string;
}

/** Один разговор с Claude Code: первое сообщение, при надобности — второе, затем ввод закрывается. */
export function runClaude(o: ClaudeRun): Promise<Transcript> {
  const t = emptyTranscript();
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(o.exe ?? findClaude(), claudeArgs(o.model, o.mcpConfig), {
        cwd: o.cwd,
        env: cleanEnv(process.env),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      t.problems.push((e as Error).message);
      resolve(t);
      return;
    }
    let buffer = "";
    let stderr = "";
    let sentFollowUp = false;
    const finishInput = () => {
      if (child.stdin?.writable) child.stdin.end();
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line === "") continue;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          t.problems.push(`не JSON: ${line.slice(0, 120)}`);
          continue;
        }
        applyEvent(t, event);
        if (isObject(event) && event.type === "result") {
          const next =
            !sentFollowUp && t.ends.length === 1 ? o.followUp?.(t) : undefined;
          if (next !== undefined && child.stdin?.writable) {
            sentFollowUp = true;
            child.stdin.write(userMessage(next));
          } else {
            finishInput();
          }
        }
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const timer = setTimeout(() => {
      t.problems.push("время вышло");
      void stopTree(child);
    }, o.timeoutMs ?? SCENARIO_TIMEOUT_MS);
    child.once("error", (e) => {
      t.problems.push(`claude не запустился: ${e.message}`);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null && t.ends.length === 0) {
        t.problems.push(
          `claude вышел с кодом ${code}${stderr.trim() === "" ? "" : `: ${stderr.trim().slice(-300)}`}`,
        );
      }
      resolve(t);
    });
    child.stdin?.write(userMessage(o.prompt));
  });
}

// ---------------------------------------------------------------------------------------------------
// Имена иконок

export interface SetTable {
  names: Set<string>;
  /** Суффиксы вариантов без пустого — длинные первыми. */
  suffixes: string[];
  /** Суффикс («» — основа) → стиль по таблице набора (ADR-0052). */
  styles: Map<string, Style>;
}

export type NameTables = Map<string, SetTable>;

/** Имена, суффиксы и стили наборов из data/: по ним видно основу имени и стиль варианта. */
export async function loadNameTables(dataDir: string): Promise<NameTables> {
  const tables: NameTables = new Map();
  for (const prefix of PREFIXES) {
    const icons = JSON.parse(
      await readFile(join(dataDir, prefix, "icons.json"), "utf8"),
    ) as { icons: Record<string, unknown>; aliases?: Record<string, unknown> };
    const meta = JSON.parse(
      await readFile(join(dataDir, prefix, "metadata.json"), "utf8"),
    ) as {
      suffixes?: Record<string, string>;
      styles?: Partial<Record<Style, string[]>>;
    };
    const styles = new Map<string, Style>();
    for (const [style, suffixes] of Object.entries(meta.styles ?? {})) {
      for (const suffix of suffixes ?? []) styles.set(suffix, style as Style);
    }
    tables.set(prefix, {
      names: new Set([
        ...Object.keys(icons.icons),
        ...Object.keys(icons.aliases ?? {}),
      ]),
      suffixes: Object.keys(meta.suffixes ?? {})
        .filter((s) => s !== "")
        .sort((a, b) => b.length - a.length),
      styles,
    });
  }
  return tables;
}

export interface IconInfo {
  prefix: string;
  name: string;
  base: string;
  suffix: string;
  style?: Style;
}

/** Основа и стиль имени: суффикс варианта отрезается, только если остаётся имя набора. */
export function iconInfo(
  tables: NameTables,
  full: string,
): IconInfo | undefined {
  const i = full.indexOf(":");
  const prefix = full.slice(0, i);
  const name = full.slice(i + 1);
  const table = tables.get(prefix);
  if (i < 0 || table === undefined || !table.names.has(name)) return undefined;
  const suffix =
    table.suffixes.find(
      (s) => name.endsWith(s) && table.names.has(name.slice(0, -s.length)),
    ) ?? "";
  const base = suffix === "" ? name : name.slice(0, -suffix.length);
  const style = table.styles.get(suffix);
  return {
    prefix,
    name,
    base,
    suffix,
    ...(style === undefined ? {} : { style }),
  };
}

/** Иконка из списка «набор:основа» и, если задан, нужного стиля. */
export function acceptable(
  tables: NameTables,
  full: string,
  list: readonly string[],
  style?: Style,
): boolean {
  const info = iconInfo(tables, full);
  return (
    info !== undefined &&
    list.includes(`${info.prefix}:${info.base}`) &&
    (style === undefined || info.style === style)
  );
}

const NAME_RE = new RegExp(
  `\\b(${PREFIXES.join("|")})(?::|--)([a-z0-9]+(?:-[a-z0-9]+)*)`,
  "g",
);

/** Имена иконок в тексте: набор:иконка и класс CSS набор--иконка — по порядку, без повторов. */
export function namesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NAME_RE)) {
    const full = `${m[1]}:${m[2]}`;
    if (!out.includes(full)) out.push(full);
  }
  return out;
}

/** Нумерованный список выдачи pick_icon и search_icons: «3. lucide:share — …». */
export function numberedIcons(text: string): { n: number; icon: string }[] {
  return [...text.matchAll(/^\s*(\d+)\.\s+([a-z0-9-]+:[a-z0-9-]+)/gm)].map(
    (m) => ({ n: Number(m[1]), icon: m[2] ?? "" }),
  );
}

// ---------------------------------------------------------------------------------------------------
// Код

/** Блоки кода из ответа. */
export function codeBlocks(text: string): string[] {
  return [...text.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)].map(
    (m) => m[1] ?? "",
  );
}

const TAG_RE = /<iconavo-icon\b[^>]*\bicon\s*=\s*["'][a-z0-9-]+:[a-z0-9-]+["']/;
const TAG_SETUP_RE =
  /(?:npm|pnpm|yarn)\s+(?:install|i|add)\s+(?:[^\n]*\s)?@iconavo-ui\/icon|iconavo-icon(?:\.min)?\.js|import\s+["']@iconavo-ui\/icon["']/;
const REACT_RE = /<Icon\b[^>]*\bicon\s*=\s*\{?\s*["'][a-z0-9-]+:[a-z0-9-]+["']/;
const REACT_IMPORT_RE = /from\s+["']@iconavo-ui\/react["']/;
const REACT_SETUP_RE =
  /(?:npm|pnpm|yarn)\s+(?:install|i|add)\s+(?:[^\n]*\s)?@iconavo-ui\/react|"@iconavo-ui\/react"\s*:/;
const SVG_RE = /<svg\b[^>]*\bviewBox\s*=/;
const NEXT_RE = /IconavoProvider|loadIcons/;

/**
 * CSS-класс с иконкой: в правиле — url( и маска или фон, в любом порядке (у get_icon сначала --svg,
 * потом mask-image: var(--svg)); или ссылка на CSS edge API.
 */
export function hasCssIcon(code: string): boolean {
  for (const m of code.matchAll(/\.[A-Za-z][\w-]*\s*\{([^}]*)\}/g)) {
    const body = m[1] ?? "";
    if (/url\(/.test(body) && /mask|background/.test(body)) return true;
  }
  return /<link\b[^>]*\.css\?icons=/.test(code);
}

/**
 * Вид кода: тег и React — со строкой установки (в тексте, в коде или в package.json проекта), SVG —
 * разметка с viewBox, CSS — класс с маской или фоном, Next.js — подключение с IconavoProvider.
 */
export function codeVerdict(
  kind: CodeKind,
  code: string,
  all: string,
): Verdict {
  const tag = TAG_RE.test(code);
  const tagSetup = TAG_SETUP_RE.test(all);
  const react = REACT_RE.test(code) && REACT_IMPORT_RE.test(code);
  const reactSetup = REACT_SETUP_RE.test(all);
  const svg = SVG_RE.test(code);
  const css = hasCssIcon(code);
  switch (kind) {
    case "html":
      if (!tag) return fail("нет тега <iconavo-icon icon=…>");
      return tagSetup ? pass("тег и установка") : fail("тег без установки");
    case "react":
      if (!react) return fail("нет <Icon icon=…> из @iconavo-ui/react");
      return reactSetup
        ? pass("компонент и установка")
        : fail("компонент без установки");
    case "svg":
      return svg ? pass("SVG-разметка") : fail("нет SVG-разметки");
    case "css":
      return css
        ? pass("CSS-класс с иконкой")
        : fail("нет CSS-класса с иконкой");
    case "next":
      return /@iconavo-ui\/react/.test(all) && NEXT_RE.test(all)
        ? pass("Next.js: @iconavo-ui/react и IconavoProvider")
        : fail("нет подключения @iconavo-ui/react с IconavoProvider");
    case "any":
      if (tag && tagSetup) return pass("тег и установка");
      if (react && reactSetup) return pass("компонент и установка");
      if (svg) return pass("SVG-разметка");
      if (css) return pass("CSS-класс с иконкой");
      if (tag || react) return fail("код без установки");
      return fail("кода иконки нет");
  }
}

const LICENSE_RE = /\b(?:MIT|ISC|Apache)\b/;
const AUTHOR_RE =
  /Lucide|Tabler|Paweł|Pawel|Phosphor|Google|Microsoft|Material Symbols|Fluent|Feather|Cole Bemis/;

export function licenseVerdict(text: string): Verdict {
  const license = LICENSE_RE.exec(text)?.[0];
  const author = AUTHOR_RE.exec(text)?.[0];
  if (license === undefined) return fail("лицензия не названа");
  if (author === undefined) return fail("автор не назван");
  return pass(`${license}, ${author}`);
}

/** Набор в одном стиле: у каждого понятия — подходящая иконка, все из одного набора и варианта. */
export function setVerdict(
  tables: NameTables,
  rule: SetRule,
  names: readonly string[],
): Verdict {
  const infos = names
    .map((n) => iconInfo(tables, n))
    .filter((x): x is IconInfo => x !== undefined)
    .filter((x) => rule.prefix === undefined || x.prefix === rule.prefix)
    .filter((x) => rule.suffix === undefined || x.suffix === rule.suffix)
    .filter((x) => rule.style === undefined || x.style === rule.style);
  const chosen: IconInfo[] = [];
  const missing: string[] = [];
  for (const [concept, bases] of Object.entries(rule.concepts)) {
    // Предпочтение — набору и варианту уже выбранных: ответ обычно перечисляет и запасные.
    const fits = infos.filter((x) => bases.includes(x.base));
    const first = chosen[0];
    const same =
      first === undefined
        ? undefined
        : fits.find(
            (x) => x.prefix === first.prefix && x.suffix === first.suffix,
          );
    const pick = same ?? fits[0];
    if (pick === undefined) missing.push(concept);
    else chosen.push(pick);
  }
  if (missing.length > 0)
    return fail(`нет подходящей иконки: ${missing.join(", ")}`);
  const sets = new Set(chosen.map((x) => x.prefix));
  const variants = new Set(chosen.map((x) => `${x.prefix}${x.suffix}`));
  if (sets.size > 1 || variants.size > 1) {
    return fail(
      `разные наборы или варианты: ${chosen.map((x) => `${x.prefix}:${x.name}`).join(", ")}`,
    );
  }
  return pass(chosen.map((x) => `${x.prefix}:${x.name}`).join(", "));
}

// ---------------------------------------------------------------------------------------------------
// Проект: файлы и проверка в браузере

const TEXT_EXT = /\.(html|tsx|ts|jsx|js|css|json|md|svg|vue|svelte)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".vite"]);

async function textFiles(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path);
      } else if (
        TEXT_EXT.test(entry.name) &&
        entry.name !== "package-lock.json"
      ) {
        out.set(
          relative(dir, path).replaceAll("\\", "/"),
          await readFile(path, "utf8"),
        );
      }
    }
  }
  if (existsSync(dir)) await walk(dir);
  return out;
}

/** Новые и изменённые файлы папки сценария против проекта-заготовки. */
export async function changedFiles(
  dir: string,
  fixture: string | undefined,
): Promise<{ path: string; content: string }[]> {
  const now = await textFiles(dir);
  const before =
    fixture === undefined
      ? new Map<string, string>()
      : await textFiles(fixture);
  return [...now]
    .filter(([path, content]) => before.get(path) !== content)
    .map(([path, content]) => ({ path, content }));
}

/** Проект открывается в Chrome, иконки нарисованы, ошибок в консоли нет. */
async function renderVerdict(
  browser: Browser,
  kind: ProjectKind,
  dir: string,
  fixture: string,
  shotPath: string,
): Promise<Verdict> {
  let root = dir;
  if (kind === "react") {
    const before = await readFile(join(fixture, "package.json"), "utf8");
    const now = await readFile(join(dir, "package.json"), "utf8");
    if (before !== now) {
      await run(
        "npm",
        ["install", "--no-audit", "--no-fund", "--ignore-scripts"],
        dir,
      );
    }
    try {
      await run("npm", ["run", "build"], dir);
    } catch (e) {
      return fail(
        `сборка не прошла: ${(e as Error).message.split("\n").slice(-3).join(" ")}`,
      );
    }
    root = join(dir, "dist");
  }
  const server = await startStatic(root);
  const context = await browser.newContext({
    viewport: { width: 1000, height: 800 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/.test(m.location().url)) {
      errors.push(m.text());
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`${server.url}/index.html`, { waitUntil: "load" });
    const state = await waitDrawn(page, DRAW_TIMEOUT_MS);
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    const drawn = drawnVerdict(state);
    if (drawn.ok !== true) return drawn;
    return errors.length === 0
      ? drawn
      : fail(
          `${drawn.note}, но ошибки в консоли: ${errors.slice(0, 2).join("; ")}`,
        );
  } finally {
    await context.close();
    await server.stop();
  }
}

// ---------------------------------------------------------------------------------------------------
// Оценка сценария

export type CriterionId =
  | "tool"
  | "icon"
  | "code"
  | "license"
  | "set"
  | "render";
export const CRITERIA: readonly CriterionId[] = [
  "tool",
  "icon",
  "code",
  "license",
  "set",
  "render",
];
export const CRITERION_TITLES: Record<CriterionId, string> = {
  tool: "Инструмент",
  icon: "Иконка",
  code: "Код",
  license: "Лицензия",
  set: "Набор",
  render: "В браузере",
};

export interface ScenarioResult {
  id: number;
  lang: "ru" | "en";
  group: ClientScenario["group"];
  prompt: string;
  verdicts: Partial<Record<CriterionId, Verdict>>;
  /** Засчитан: все признаки сценария — «да». */
  passed: boolean;
  /** Сбой настройки или прогона — не ошибка ассистента, сценарий не засчитывается ни так, ни так. */
  setup: string[];
  tools: string[];
  /** Иконки, которые ассистент взял в код или get_icon. */
  icons: string[];
  followUp?: string;
  answer: string;
  files: string[];
  turns: number;
  durationMs: number;
  costUsd: number;
  problems: string[];
}

/** Иконки, которые ассистент взял: вход get_icon и имена в коде; нет — имена из текста ответа. */
export function usedIcons(t: Transcript, code: string): string[] {
  const fromCalls = t.calls
    .filter((c) => c.mcp && c.name === "get_icon")
    .map((c) => str(c.input.icon))
    .filter((n) => n !== "");
  const used = [...new Set([...fromCalls, ...namesIn(code)])];
  return used.length > 0 ? used : namesIn(t.texts.join("\n"));
}

export function judge(
  s: ClientScenario,
  tables: NameTables,
  t: Transcript,
  files: { path: string; content: string }[],
  render?: Verdict,
): Omit<ScenarioResult, "followUp" | "files" | "problems"> {
  const text = t.texts.join("\n\n");
  const fileText = files.map((f) => f.content).join("\n");
  const code = [...codeBlocks(text), fileText].join("\n");
  const codeOrText = code.trim() === "" ? text : code;
  const all = `${text}\n${fileText}\n${t.calls
    .filter((c) => c.name === "Bash")
    .map((c) => str(c.input.command))
    .join("\n")}`;
  const verdicts: Partial<Record<CriterionId, Verdict>> = {};
  const called = t.calls.filter((c) => c.mcp).map((c) => c.name);
  const used = s.tools.filter((tool) => called.includes(tool));
  verdicts.tool =
    used.length > 0
      ? pass(used.join(", "))
      : fail(
          called.length === 0
            ? "инструменты не вызывались"
            : `вызваны ${[...new Set(called)].join(", ")}`,
        );
  const icons = usedIcons(t, code);
  if (s.icons !== undefined) {
    const good = icons.filter((n) =>
      acceptable(tables, n, s.icons ?? [], s.style),
    );
    verdicts.icon =
      good.length > 0
        ? pass(good.slice(0, 3).join(", "))
        : fail(
            icons.length === 0
              ? "иконка не выбрана"
              : `не те: ${icons.slice(0, 4).join(", ")}`,
          );
  }
  if (s.code !== undefined) {
    const kind = codeVerdict(s.code, codeOrText, all);
    const extra = kind.ok === true ? s.codeCheck?.(codeOrText) : undefined;
    verdicts.code = extra === undefined ? kind : fail(extra);
  }
  if (s.license === true) {
    const license = licenseVerdict(text);
    const extra = license.ok === true ? s.answerCheck?.(text) : undefined;
    verdicts.license = extra === undefined ? license : fail(extra);
  } else if (s.answerCheck !== undefined) {
    const extra = s.answerCheck(text);
    verdicts.license = extra === undefined ? pass("ответ полный") : fail(extra);
  }
  if (s.set !== undefined) {
    verdicts.set = setVerdict(tables, s.set, [
      ...namesIn(code),
      ...namesIn(text),
    ]);
  }
  if (render !== undefined) verdicts.render = render;
  const setup = setupProblems(t.init);
  const end = t.ends.at(-1);
  return {
    id: s.id,
    lang: s.lang,
    group: s.group,
    prompt: s.prompt,
    verdicts,
    passed:
      setup.length === 0 && Object.values(verdicts).every((v) => v.ok === true),
    setup,
    tools: t.calls.map((c) => c.name),
    icons,
    answer: end?.text ?? t.texts.at(-1) ?? "",
    turns: t.ends.reduce((sum, e) => sum + e.turns, 0),
    durationMs: t.ends.reduce((sum, e) => sum + e.durationMs, 0),
    costUsd: t.ends.reduce((sum, e) => sum + e.costUsd, 0),
  };
}

/**
 * «Найти» без сетки: ассистент показал список с номерами и не дал кода — человек отвечает номером
 * первой подходящей иконки из выдачи.
 */
export function findFollowUp(
  s: ClientScenario,
  tables: NameTables,
  t: Transcript,
): string | undefined {
  if (s.group !== "find" || s.icons === undefined) return undefined;
  if (t.calls.some((c) => c.mcp && c.name === "get_icon")) return undefined;
  const text = t.texts.join("\n");
  if (codeVerdict("any", [...codeBlocks(text)].join("\n") || text, text).ok) {
    return undefined;
  }
  const listed = t.results
    .filter((r) => r.name === "pick_icon" || r.name === "search_icons")
    .flatMap((r) => numberedIcons(r.text));
  const good = listed.find((x) =>
    acceptable(tables, x.icon, s.icons ?? [], s.style),
  );
  return good === undefined ? undefined : String(good.n);
}

// ---------------------------------------------------------------------------------------------------
// Прогон

export interface ClientsOptions {
  root: string;
  dataDir: string;
  scenarios: readonly ClientScenario[];
  model: string;
  reportDir: string;
  /** Оставить папки сценариев — для разбора. */
  keep?: boolean;
  log?: (line: string) => void;
}

export interface ClientsReport {
  model: string;
  version: string;
  build: string;
  startedAt: string;
  runDir: string;
  results: ScenarioResult[];
  stoppedBySubscription: boolean;
}

/** Метка сборки живого сервера — в отчёт: итог считается после последней выкладки. */
export async function liveBuild(): Promise<string> {
  try {
    const response = await fetch(`${MCP_ORIGIN}/`);
    return response.headers.get("x-iconavo-build") ?? "?";
  } catch {
    return "?";
  }
}

const stamp = (d: Date) =>
  d.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

export async function runClients(o: ClientsOptions): Promise<ClientsReport> {
  const started = new Date();
  const runDir = join(tmpdir(), "iconavo-mcp-clients", stamp(started));
  await mkdir(runDir, { recursive: true });
  const mcpConfig = join(runDir, "mcp.json");
  await writeFile(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        iconavo: { type: "http", url: `${MCP_ORIGIN}${MCP_PATH}` },
      },
    }),
    "utf8",
  );
  const shotsDir = join(o.reportDir, "clients");
  await mkdir(shotsDir, { recursive: true });
  const tables = await loadNameTables(o.dataDir);
  const fixtures = join(
    o.root,
    "packages",
    "pipeline",
    "fixtures",
    "mcp-clients",
  );
  const exe = findClaude();
  const report: ClientsReport = {
    model: o.model,
    version: "",
    build: await liveBuild(),
    startedAt: started.toISOString(),
    runDir,
    results: [],
    stoppedBySubscription: false,
  };
  let browser: Browser | undefined;
  try {
    for (const s of o.scenarios) {
      if (report.stoppedBySubscription) break;
      const dir = join(runDir, `s${String(s.id).padStart(2, "0")}`);
      const fixture =
        s.project === undefined ? undefined : join(fixtures, s.project);
      if (fixture === undefined) await mkdir(dir, { recursive: true });
      else await cp(fixture, dir, { recursive: true });
      if (s.project === "react") {
        await run(
          "npm",
          [
            "ci",
            "--prefer-offline",
            "--no-audit",
            "--no-fund",
            "--ignore-scripts",
          ],
          dir,
        );
      }
      o.log?.(`${s.id}. ${s.prompt}`);
      let followUp: string | undefined;
      const t = await runClaude({
        cwd: dir,
        prompt: s.prompt,
        model: o.model,
        mcpConfig,
        exe,
        followUp: (sofar) => {
          followUp = findFollowUp(s, tables, sofar);
          return followUp;
        },
      });
      report.version ||= t.init?.version ?? "";
      if (t.subscriptionLimited) report.stoppedBySubscription = true;
      const files = await changedFiles(dir, fixture);
      let render: Verdict | undefined;
      if (s.project !== undefined && fixture !== undefined) {
        browser ??= await launchBrowser("chrome", true);
        render = await renderVerdict(
          browser,
          s.project,
          dir,
          fixture,
          join(shotsDir, `s${String(s.id).padStart(2, "0")}.png`),
        ).catch((e: Error) =>
          fail(`страница не открылась: ${e.message.split("\n")[0]}`),
        );
      }
      const result: ScenarioResult = {
        ...judge(s, tables, t, files, render),
        ...(followUp === undefined ? {} : { followUp }),
        files: files.map((f) => f.path),
        problems: t.problems,
      };
      report.results.push(result);
      o.log?.(
        `   ${result.setup.length > 0 ? "сбой настройки" : result.passed ? "да" : "нет"} — ${CRITERIA.filter(
          (c) => result.verdicts[c] !== undefined,
        )
          .map(
            (c) =>
              `${CRITERION_TITLES[c]}: ${result.verdicts[c]?.ok === true ? "да" : "нет"}`,
          )
          .join(", ")}`,
      );
      if (o.keep !== true) {
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 500,
        }).catch(() => {});
      }
    }
  } finally {
    await browser?.close();
    if (o.keep !== true) {
      await rm(runDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
      }).catch(() => {});
    }
  }
  return report;
}

export const clientsFailed = (r: ClientsReport) =>
  r.stoppedBySubscription || r.results.some((x) => !x.passed);
