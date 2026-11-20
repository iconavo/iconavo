// get_icon (ADR-0011, ADR-0044): код одной иконки. По умолчанию — веб-компонент <iconavo-icon> (решение
// владельца 19 ноября 2026), по просьбе — React или чистый SVG с комментарием об авторстве. Размер,
// цвет, толщина линии и поворот — тем же правилом, что у генератора сайта. Сведения — маршрут /icon
// edge API: основное имя, стиль и другие стили, описание, похожие в том же стиле, автор и лицензия.

import { attributionText } from "@iconavo-ui/snippets/icon";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  appliedOf,
  codeOf,
  FORMAT_TITLES,
  FORMATS,
  LookFields,
  type Setup,
  settingsOf,
  setupFor,
} from "../code.js";
import { SITE_URL } from "../config.js";
import type { Call, McpDeps } from "../context.js";
import { iconBody, iconDetails } from "../details.js";
import { toolError } from "../errors.js";
import {
  CreditSchema,
  IconName,
  SetInfoSchema,
  StyleSchema,
} from "../schemas.js";

export const ICON_NAME = "get_icon";

export const ICON_DESCRIPTION = [
  'Get ready-to-paste code for one icon by its full name from search_icons, e.g. "lucide:house".',
  'By default the code uses the Iconavo package: format "html" — the <iconavo-icon> web component (works in any framework and in plain HTML);',
  'use format "react" in React and Next.js projects; use "svg" only when the user explicitly needs raw SVG markup.',
  "Also returns the icon's set, license, author and attribution text, other styles of the same drawing, similar icons in the same style and a description.",
  "Call get_usage once per project to install and set up the package.",
].join(" ");

export const IconInput = z.object({
  icon: IconName.describe(
    'Full icon name "set:icon" from search_icons, e.g. "lucide:house"; old names also work',
  ),
  ...LookFields,
  rotate: z
    .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
    .default(0)
    .describe("Rotation in degrees, clockwise"),
});

export type IconArgs = z.output<typeof IconInput>;

const SetupSchema = z.object({
  install: z.string().describe("Install command, once per project"),
  import: z.string().describe("Import line, once per project"),
  script: z
    .string()
    .optional()
    .describe("Without a build step: these <head> lines instead of npm"),
});

export const IconOutput = z.object({
  icon: z.string().describe("Main name of the icon"),
  requested: z
    .string()
    .optional()
    .describe("The old name that was asked for, if it differs"),
  hidden: z
    .boolean()
    .describe("true — the author removed this icon; prefer another one"),
  format: z.enum(FORMATS),
  code: z.string(),
  setup: SetupSchema.optional().describe("For html and react"),
  svgUrl: z
    .string()
    .optional()
    .describe("The same SVG from the Iconavo API, for svg"),
  applied: z.object({
    size: z.number(),
    color: z.string().optional(),
    strokeWidth: z.number().optional(),
    rotate: z.number().optional(),
  }),
  notes: z.array(z.string()),
  set: SetInfoSchema,
  attribution: z
    .string()
    .describe("Attribution text to keep with the icon (license and author)"),
  credits: z
    .array(CreditSchema)
    .optional()
    .describe("This icon comes from another set"),
  style: StyleSchema.nullable(),
  styles: z
    .array(z.object({ style: StyleSchema, icons: z.array(z.string()) }))
    .describe("The same drawing in each style: main name first"),
  tones: z.array(z.string()).describe("Skin tones (Fluent Emoji)"),
  description: z.object({ en: z.string(), ru: z.string() }).nullable(),
  tags: z.array(z.string()),
  similar: z.array(z.string()).describe("Similar icons in the same style"),
  page: z.string(),
});

export type IconResult = z.output<typeof IconOutput>;

function text(r: IconResult, partial: boolean): string {
  const others = r.styles
    .filter((s) => s.style !== r.style)
    .map((s) => `${s.style} — ${s.icons[0]}`);
  const setup =
    r.setup === undefined
      ? []
      : [
          `Setup, once per project: ${r.setup.install}, then ${r.setup.import}${r.setup.script === undefined ? "" : " — or, without a build step, the <script> and <style> lines from get_usage"}.`,
        ];
  return [
    `${r.icon} — ${r.set.name}${r.style === null ? "" : `, ${r.style}`}.`,
    ...(r.requested === undefined
      ? []
      : [`${r.requested} is an old name of this icon.`]),
    ...(r.hidden
      ? [
          "The author removed this icon: it still works, but prefer another one.",
        ]
      : []),
    "",
    `Code (${FORMAT_TITLES[r.format]}):`,
    r.code,
    "",
    ...setup,
    ...(r.svgUrl === undefined ? [] : [`The same SVG by URL: ${r.svgUrl}`]),
    ...r.notes,
    `License — keep this attribution: ${r.attribution}`,
    ...(others.length === 0 ? [] : [`Other styles: ${others.join("; ")}.`]),
    ...(r.similar.length === 0
      ? []
      : [`Similar icons in the same style: ${r.similar.join(", ")}.`]),
    ...(r.description === null ? [] : [`Description: ${r.description.en}`]),
    ...(partial
      ? [
          "Description, other styles and similar icons are temporarily unavailable.",
        ]
      : []),
    `Page: ${r.page}`,
  ].join("\n");
}

export async function getIcon(
  deps: McpDeps,
  call: Call,
  args: IconArgs,
): Promise<CallToolResult> {
  try {
    const { details, partial } = await iconDetails(deps, call, args.icon);
    const applies = { palette: details.set.palette, strokes: details.strokes };
    const settings = settingsOf(args);
    const { applied, notes } = appliedOf(args, applies, details.set.name);
    const code = codeOf(
      args.format,
      details.icon,
      settings,
      applies,
      deps.usage.install,
      args.format === "svg"
        ? { icon: await iconBody(deps, call, details.icon), details }
        : undefined,
    );
    const setup: Setup | undefined =
      args.format === "svg"
        ? undefined
        : setupFor(args.format, deps.usage.install);
    const result: IconResult = {
      icon: details.icon,
      ...(details.alias === undefined ? {} : { requested: details.alias }),
      hidden: details.hidden === true,
      format: args.format,
      code: code.code,
      ...(setup === undefined ? {} : { setup }),
      ...(code.svgUrl === undefined ? {} : { svgUrl: code.svgUrl }),
      applied,
      notes,
      set: details.set,
      attribution: attributionText(details),
      ...(details.credits === undefined ? {} : { credits: details.credits }),
      style: details.style,
      styles: details.variants,
      tones: details.tones,
      description: details.description,
      tags: details.tags,
      similar: details.similar,
      page: `${SITE_URL}/${details.icon.replace(":", "/")}`,
    };
    return {
      content: [{ type: "text", text: text(result, partial) }],
      structuredContent: result,
    };
  } catch (e) {
    return toolError(e, deps.log);
  }
}
