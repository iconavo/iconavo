import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  acceptable,
  applyEvent,
  claudeArgs,
  cleanEnv,
  codeBlocks,
  codeVerdict,
  emptyTranscript,
  findFollowUp,
  iconInfo,
  judge,
  licenseVerdict,
  loadNameTables,
  type NameTables,
  namesIn,
  numberedIcons,
  setupProblems,
  setVerdict,
  type Transcript,
  userMessage,
} from "./clients.js";
import { CLIENT_SCENARIOS, redProblem } from "./clients-scenarios.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DATA = join(ROOT, "data");

let tables: NameTables;
beforeAll(async () => {
  tables = await loadNameTables(DATA);
});

const scenario = (id: number) => {
  const s = CLIENT_SCENARIOS.find((x) => x.id === id);
  if (s === undefined) throw new Error(`нет сценария ${id}`);
  return s;
};

const INIT = {
  type: "system",
  subtype: "init",
  model: "claude-sonnet-5-5",
  apiKeySource: "none",
  claude_code_version: "2.1.329",
  mcp_servers: [{ name: "iconavo", status: "connected" }],
  plugins: [{ name: "cc-plugin-telemetry", path: "builtin" }],
  tools: ["Bash", "ToolSearch", "mcp__iconavo__get_icon"],
};

/** Разговор из событий stream-json. */
function transcript(events: unknown[]): Transcript {
  const t = emptyTranscript();
  for (const e of events) applyEvent(t, e);
  return t;
}

const toolUse = (id: string, name: string, input: unknown) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const toolResult = (id: string, text: string, isError = false) => ({
  type: "user",
  parent_tool_use_id: null,
  message: {
    content: [
      {
        type: "tool_result",
        tool_use_id: id,
        is_error: isError,
        content: [{ type: "text", text }, { type: "image" }],
      },
    ],
  },
});
const say = (text: string) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content: [{ type: "text", text }] },
});
const end = (text: string) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
  num_turns: 3,
  duration_ms: 9000,
  total_cost_usd: 0.05,
});

describe("сценарии", () => {
  it("20 штук, номера 1–20, поровну русских и английских; у проектов — запрос с файлом для чатов", () => {
    expect(CLIENT_SCENARIOS.map((s) => s.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(CLIENT_SCENARIOS.filter((s) => s.lang === "ru")).toHaveLength(10);
    for (const s of CLIENT_SCENARIOS.filter((x) => x.project !== undefined)) {
      expect(s.chatPrompt, `сценарий ${s.id}`).toMatch(/```/);
    }
  });

  it("каждая подходящая иконка и основа понятия есть в data/", () => {
    for (const s of CLIENT_SCENARIOS) {
      for (const full of s.icons ?? []) {
        expect(iconInfo(tables, full), `${s.id}: ${full}`).toBeDefined();
      }
      for (const [concept, bases] of Object.entries(s.set?.concepts ?? {})) {
        for (const base of bases) {
          const found = [...tables.values()].some((t) => t.names.has(base));
          expect(found, `${s.id}: ${concept} — ${base}`).toBe(true);
        }
      }
    }
  });
});

describe("окружение и запуск", () => {
  it("без переменных Claude Code и Anthropic этой сессии, папка настроек остаётся; выключатели — поверх", () => {
    const env = cleanEnv({
      PATH: "x",
      CLAUDECODE: "1",
      CLAUDE_CODE_EFFORT_LEVEL: "max",
      ANTHROPIC_API_KEY: "secret",
      CLAUDE_CONFIG_DIR: "C:/cfg",
    });
    expect(env.PATH).toBe("x");
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe("C:/cfg");
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    expect(env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
  });

  it("аргументы: только наш сервер, без настроек, ToolSearch как у всех; запрос — не аргументом", () => {
    const args = claudeArgs("sonnet", "C:/run/mcp.json");
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(at("--setting-sources")).toBe("");
    expect(at("--mcp-config")).toBe("C:/run/mcp.json");
    expect(at("--model")).toBe("sonnet");
    expect(at("--effort")).toBe("medium");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
    expect(at("--tools")).toContain("ToolSearch");
    expect(args).toContain("mcp__iconavo__*");
    expect(JSON.parse(userMessage("Найди «дом»"))).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "Найди «дом»" }],
      },
    });
  });

  it("событие запуска: подписка, ровно наш сервер, только встроенные плагины — иначе сбой настройки", () => {
    expect(setupProblems(transcript([INIT]).init)).toEqual([]);
    expect(
      setupProblems(
        transcript([
          {
            ...INIT,
            apiKeySource: "ANTHROPIC_API_KEY",
            mcp_servers: [
              { name: "iconavo", status: "connected" },
              { name: "figma", status: "connected" },
            ],
            plugins: [{ name: "vercel", path: "C:/plugins/vercel" }],
            tools: ["mcp__figma__x"],
          },
        ]).init,
      ),
    ).toHaveLength(4);
    expect(setupProblems(undefined)).toEqual(["нет события запуска"]);
  });
});

describe("разбор событий", () => {
  it("вызовы нашего сервера без приставки, ToolSearch и подагенты — мимо, результат — текстом", () => {
    const t = transcript([
      INIT,
      toolUse("a", "ToolSearch", { query: "select:mcp__iconavo__get_icon" }),
      toolUse("b", "mcp__iconavo__get_icon", { icon: "lucide:house" }),
      toolResult("b", "Code: <iconavo-icon …>"),
      {
        ...toolUse("c", "mcp__iconavo__search_icons", {}),
        parent_tool_use_id: "x",
      },
      say("Готово"),
      end("Готово"),
      { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
    ]);
    expect(t.calls.map((c) => [c.name, c.mcp])).toEqual([["get_icon", true]]);
    expect(t.results).toEqual([
      {
        id: "b",
        name: "get_icon",
        isError: false,
        text: "Code: <iconavo-icon …>",
      },
    ]);
    expect(t.texts).toEqual(["Готово"]);
    expect(t.ends[0]?.costUsd).toBe(0.05);
    expect(t.subscriptionLimited).toBe(true);
  });
});

describe("имена иконок", () => {
  it("основа и стиль — по таблице суффиксов набора; share-off — своя основа", () => {
    expect(iconInfo(tables, "ph:share-fill")).toMatchObject({
      base: "share",
      style: "filled",
    });
    expect(iconInfo(tables, "material-symbols:bookmark")?.style).toBe("filled");
    expect(iconInfo(tables, "material-symbols:bookmark-outline")?.style).toBe(
      "outline",
    );
    expect(iconInfo(tables, "tabler:bookmark-filled")).toMatchObject({
      base: "bookmark",
      style: "filled",
    });
    expect(iconInfo(tables, "lucide:share-off")?.base).toBeUndefined();
    expect(iconInfo(tables, "nope:x")).toBeUndefined();
    const share = scenario(1).icons ?? [];
    expect(acceptable(tables, "ph:share-network-bold", share)).toBe(true);
    expect(acceptable(tables, "tabler:share-off", share)).toBe(false);
    const bookmark = scenario(4);
    expect(
      acceptable(tables, "ph:bookmark-fill", bookmark.icons ?? [], "filled"),
    ).toBe(true);
    expect(
      acceptable(tables, "lucide:bookmark", bookmark.icons ?? [], "filled"),
    ).toBe(false);
  });

  it("в тексте — набор:иконка и класс CSS набор--иконка, по порядку и без повторов", () => {
    expect(
      namesIn(
        'Use lucide:share-2 or <span class="ph--share-fat-bold"></span>; graph:x and lucide:share-2 again',
      ),
    ).toEqual(["lucide:share-2", "ph:share-fat-bold"]);
    expect(
      numberedIcons(
        "The picker shows 3 icons\n1. lucide:share — Lucide, outline\n2. ph:share-network — Phosphor",
      ),
    ).toEqual([
      { n: 1, icon: "lucide:share" },
      { n: 2, icon: "ph:share-network" },
    ]);
    expect(codeBlocks("text\n```html\n<b>x</b>\n```\nmore")).toEqual([
      "<b>x</b>\n",
    ]);
  });
});

describe("как Claude Code отдаёт ответы", () => {
  it("выдача — данными JSON (results с n и icon), а не текстом; код — и в ячейках таблицы", () => {
    expect(
      numberedIcons(
        JSON.stringify({
          query: "trophy",
          results: [
            { n: 1, icon: "material-symbols:trophy", set: "x" },
            { n: 4, icon: "lucide:trophy", set: "y" },
          ],
        }),
      ),
    ).toEqual([
      { n: 1, icon: "material-symbols:trophy" },
      { n: 4, icon: "lucide:trophy" },
    ]);
    const table =
      '| Play | `tabler:player-play` | `<iconavo-icon icon="tabler:player-play" width="24"></iconavo-icon>` |\n```\nnpm install @iconavo-ui/icon\n```';
    expect(codeBlocks(table)).toEqual([
      "npm install @iconavo-ui/icon\n",
      '<iconavo-icon icon="tabler:player-play" width="24"></iconavo-icon>',
    ]);
  });
});

describe("признаки", () => {
  it("вид кода: тег и React — только со строкой установки, SVG, CSS, Next.js", () => {
    const tag = '<iconavo-icon icon="lucide:trash" width="24"></iconavo-icon>';
    expect(
      codeVerdict("html", tag, `npm install @iconavo-ui/icon\n${tag}`).ok,
    ).toBe(true);
    expect(codeVerdict("html", tag, tag).ok).toBe(false);
    const react =
      'import { Icon } from "@iconavo-ui/react";\n<Icon icon="lucide:house" width={32} />';
    expect(
      codeVerdict("react", react, `npm install @iconavo-ui/react\n${react}`).ok,
    ).toBe(true);
    expect(
      codeVerdict("svg", '<svg viewBox="0 0 24 24"><path/></svg>', "").ok,
    ).toBe(true);
    expect(
      codeVerdict(
        "css",
        '.tabler--download {\n  --svg: url("data:image/svg+xml,...");\n  mask-image: var(--svg);\n}',
        "",
      ).ok,
    ).toBe(true);
    expect(codeVerdict("css", ".plain { color: red; }", "").ok).toBe(false);
    expect(
      codeVerdict(
        "css",
        '.tabler--download {\n  -webkit-mask-image: url("data:image/svg+xml,...");\n}',
        "",
      ).ok,
    ).toBe(true);
    expect(
      codeVerdict(
        "next",
        "",
        'import { IconavoProvider } from "@iconavo-ui/react";',
      ).ok,
    ).toBe(true);
    expect(codeVerdict("any", "no code", "no code").ok).toBe(false);
  });

  it("лицензия и автор; красный цвет — hex или слово", () => {
    expect(licenseVerdict("License: ISC, Lucide Contributors").ok).toBe(true);
    expect(licenseVerdict("License: ISC").ok).toBe(false);
    expect(redProblem('<Icon color="#e11d48" />')).toBeUndefined();
    expect(redProblem('<Icon color="red" />')).toBeUndefined();
    expect(redProblem('<Icon color="#2563eb" />')).toBe("цвет не красный");
  });

  it("набор: у каждого понятия — иконка из одного набора и варианта; бланк анализов — не профиль", () => {
    const rule = scenario(15).set;
    if (rule === undefined) throw new Error("нет правила");
    expect(
      setVerdict(tables, rule, [
        "lucide:house",
        "lucide:search",
        "lucide:bell",
        "lucide:user",
      ]).ok,
    ).toBe(true);
    expect(
      setVerdict(tables, rule, [
        "material-symbols:home",
        "material-symbols:search",
        "material-symbols:notifications",
        "material-symbols:lab-profile-outline",
      ]).note,
    ).toMatch(/профиль/);
    const bold = scenario(16).set;
    if (bold === undefined) throw new Error("нет правила");
    expect(
      setVerdict(tables, bold, ["ph:gear-bold", "ph:user-bold", "ph:bell-bold"])
        .ok,
    ).toBe(true);
    expect(
      setVerdict(tables, bold, ["ph:gear", "ph:user-bold", "ph:bell-bold"]).ok,
    ).toBe(false);
  });

  it("оценка сценария: React-код lucide:house 32 px красным с установкой и лицензией — засчитан", () => {
    const answer =
      'Install: npm install @iconavo-ui/react\n```tsx\nimport { Icon } from "@iconavo-ui/react";\n\n<Icon icon="lucide:house" width={32} color="#ef4444" />\n```\nLicense: ISC, Lucide Contributors.';
    const t = transcript([
      INIT,
      toolUse("b", "mcp__iconavo__get_icon", {
        icon: "lucide:house",
        format: "react",
      }),
      toolResult("b", "Code…"),
      say(answer),
      end(answer),
    ]);
    const r = judge(scenario(10), tables, t, []);
    expect(r.verdicts.tool?.ok).toBe(true);
    expect(r.verdicts.icon?.ok).toBe(true);
    expect(r.verdicts.code).toEqual({
      ok: true,
      note: "компонент и установка",
    });
    expect(r.verdicts.license?.ok).toBe(true);
    expect(r.passed).toBe(true);
    const blue = judge(
      scenario(10),
      tables,
      transcript([INIT, say(answer.replace("#ef4444", "#2563eb")), end("")]),
      [],
    );
    expect(blue.verdicts.code?.note).toBe("цвет не красный");
    expect(blue.passed).toBe(false);
  });

  it("«найти» без сетки: человек отвечает номером первой подходящей иконки из выдачи; код уже есть — не отвечает", () => {
    const list = transcript([
      INIT,
      toolUse("p", "mcp__iconavo__pick_icon", { query: "поделиться" }),
      toolResult(
        "p",
        "The picker shows 12 icons\n1. lucide:share-off — Lucide\n2. ph:share-network — Phosphor",
      ),
      say("Какой номер выбрать?"),
      end("Какой номер выбрать?"),
    ]);
    expect(findFollowUp(scenario(1), tables, list)).toBe("2");
    const done = transcript([
      INIT,
      toolUse("g", "mcp__iconavo__get_icon", { icon: "lucide:share" }),
      end(""),
    ]);
    expect(findFollowUp(scenario(1), tables, done)).toBeUndefined();
    expect(findFollowUp(scenario(10), tables, list)).toBeUndefined();
  });
});
