// pick_icon (шаг 11 фазы 4, ADR-0045): сетка выбора иконки прямо в чате — интерфейс MCP Apps ui://picker.
// Поиск — тот же, что у search_icons (findIcons), 12 вариантов. В ответе три части:
// - текст и картинка-сетка — модели и клиентам без MCP Apps: там ассистент просит назвать номер;
// - structuredContent — карточки с лицензией и автором, как у search_icons;
// - _meta — данные сетки (рисунки всех стилей, сведения о наборах, строки установки): их видит только
//   сетка, модель — нет. По ним сетка сама считает код выбранной иконки теми же функциями, что get_icon.
// Инструмент объявлен всегда: сервер без состояния не знает, умеет ли клиент MCP Apps (ADR-0045).

import { normalizeColor } from "@iconavo-ui/snippets/look";
import {
  PICKER_META_KEY,
  PICKER_SIZE,
  type PickerCard,
  type PickerIcon,
  pickerPayload,
} from "@iconavo-ui/snippets/picker";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod";
import { FORMATS, LookFields } from "../code.js";
import { API_ORIGIN, SITE_URL } from "../config.js";
import type { Call, McpDeps } from "../context.js";
import { toolError } from "../errors.js";
import { toBase64 } from "../png.js";
import { SetInfoSchema } from "../schemas.js";
import { iconCredits, licenseLine } from "../sets.js";
import {
  findIcons,
  gridPreview,
  ResultSchema,
  readIcons,
  SearchInput,
} from "./search.js";

export const PICK_NAME = "pick_icon";

export const PICK_DESCRIPTION = [
  'Let the user choose an icon themselves: shows an interactive grid of 12 icons for a need in any language, e.g. "share button" or "корзина", right in the chat — in clients that support MCP Apps (Claude, ChatGPT, VS Code and others).',
  "The user can switch the style, preview a color and press Select; the choice then comes back to you as a short message, with the ready code, license and author in your context.",
  "Use it when the user wants to pick or see options; to choose by yourself, use search_icons and get_icon.",
  "Without MCP Apps you get a numbered list and ONE PNG image of the same icons: show it, ask the user for a number, then call get_icon.",
].join(" ");

export const PickInput = z.object({
  query: SearchInput.shape.query,
  sets: SearchInput.shape.sets,
  style: SearchInput.shape.style,
  license: SearchInput.shape.license,
  format: LookFields.format,
  size: LookFields.size,
  color: LookFields.color.describe(
    "Starting color of the preview, hex such as #e11d48, e.g. the brand color; the user can change it. Omit for the text color",
  ),
});

export type PickArgs = z.output<typeof PickInput>;

export const PickOutput = z.object({
  query: z.string(),
  ranking: z
    .enum(["meaning", "words"])
    .describe(
      "meaning — ranked by meaning and words; words — by words only (the meaning model did not answer)",
    ),
  matched: z
    .boolean()
    .describe(
      "false — no icon matched the words; results are the closest by meaning",
    ),
  count: z.number().int(),
  results: z.array(ResultSchema),
  sets: z
    .array(SetInfoSchema)
    .describe("Author and license of every set in the results"),
  format: z.enum(FORMATS).describe("Kind of code the picker returns"),
  size: z.number().int().describe("Icon size in the returned code, px"),
  preview: z.boolean().describe("true — the PNG grid is attached"),
  page: z.string().describe("The same search on iconavo.dev"),
});

export type PickResult = z.output<typeof PickOutput>;

function text(result: PickResult): string {
  if (result.count === 0) {
    return `No icons found for "${result.query}". Try other words, another language or fewer filters.`;
  }
  const names = new Map(result.sets.map((s) => [s.prefix, s.name]));
  return [
    `The picker shows ${result.count} icons for "${result.query}"${result.ranking === "meaning" ? ", ranked by meaning" : ", ranked by words only"}.`,
    "If the user's client shows the picker, wait for their choice: it comes as a message, and the code, license and author arrive in your context.",
    "If no picker is shown, show the image (cell N is icon N), ask the user for a number, then call get_icon with that icon.",
    ...(result.matched
      ? []
      : [
          "No icon matched the words exactly; these are the closest by meaning.",
        ]),
    "",
    ...result.results.map(
      (r) =>
        `${r.n}. ${r.icon} — ${names.get(r.set) ?? r.set}${r.style === null ? "" : `, ${r.style}`}${r.exact ? " (exact name)" : ""}`,
    ),
    "",
    "Licenses (keep the attribution when you use the icons):",
    ...result.sets.map((s) => `- ${licenseLine(s)}`),
  ].join("\n");
}

export async function pickIcon(
  deps: McpDeps,
  call: Call,
  args: PickArgs,
): Promise<CallToolResult> {
  try {
    const found = await findIcons(deps, call, {
      query: args.query,
      ...(args.sets === undefined ? {} : { sets: args.sets }),
      ...(args.style === undefined ? {} : { style: args.style }),
      ...(args.license === undefined ? {} : { license: args.license }),
      limit: PICKER_SIZE,
      offset: 0,
      preview: true,
    });
    // Рисунки показанных иконок и всех их стилей — одним чтением на набор.
    const names = [
      ...new Set(
        found.results.flatMap((r) => [r.icon, ...Object.values(r.styles)]),
      ),
    ];
    const read = await readIcons(deps, call, names);
    const canonical = (name: string) => read.get(name)?.canonical;
    const canonicals = [
      ...new Set(
        [...read.values()].flatMap((r) => (r === null ? [] : [r.canonical])),
      ),
    ];
    const credits = await iconCredits(deps, canonicals);
    const icons = new Map<string, PickerIcon>();
    for (const r of read.values()) {
      if (r === null || icons.has(r.canonical)) continue;
      const own = credits.get(r.canonical);
      icons.set(r.canonical, {
        ...r.data,
        ...(own === undefined ? {} : { credits: own }),
      });
    }
    const cards: PickerCard[] = found.results.flatMap((r) => {
      const icon = canonical(r.icon);
      if (icon === undefined) return [];
      const styles: PickerCard["styles"] = {};
      for (const [style, name] of Object.entries(r.styles)) {
        const c = canonical(name);
        if (c !== undefined) styles[style as keyof PickerCard["styles"]] = c;
      }
      return [
        {
          n: r.n,
          icon,
          style: r.style,
          styles,
          ...(r.exact ? { exact: true as const } : {}),
        },
      ];
    });
    const payload = pickerPayload({
      query: args.query,
      api: API_ORIGIN,
      site: SITE_URL,
      format: args.format,
      size: args.size,
      ...(args.color === undefined
        ? {}
        : { color: normalizeColor(args.color) }),
      ...(args.style === undefined ? {} : { style: args.style }),
      cards,
      icons,
      sets: found.sets,
      install: deps.usage.install,
    });
    const png =
      found.results.length === 0
        ? undefined
        : await gridPreview(
            deps,
            call,
            found.results.map((r) => r.icon),
            read,
          );
    const result: PickResult = {
      query: args.query,
      ranking: found.ranking,
      matched: found.matched,
      count: found.results.length,
      results: found.results,
      sets: found.sets,
      format: args.format,
      size: args.size,
      preview: png !== undefined,
      page: `${SITE_URL}/search?q=${encodeURIComponent(args.query)}`,
    };
    return {
      content: [
        { type: "text", text: text(result) },
        ...(png === undefined
          ? []
          : [
              {
                type: "image" as const,
                data: toBase64(png),
                mimeType: "image/png",
              },
            ]),
      ],
      structuredContent: result,
      _meta: { [PICKER_META_KEY]: payload },
    };
  } catch (e) {
    return toolError(e, deps.log);
  }
}
