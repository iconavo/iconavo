// get_usage (ADR-0011, ADR-0044): как поставить и подключить пакет. Текст — из README тега, одобренного
// владельцем «договора» с разработчиками (packages/icon/README.md): разделы вшиваются в функцию при
// сборке (pnpm mcp build), нужного раздела нет — сборка останавливается. Так ассистент видит ровно то,
// что написано в документации, и та же версия пакета, что в README.

import { installCommand } from "@iconavo-ui/snippets/install";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod";
import { PACKAGE_MANAGERS } from "../code.js";
import { SITE_URL } from "../config.js";
import type { McpDeps } from "../context.js";

export const USAGE_NAME = "get_usage";

export const FRAMEWORKS = ["html", "script", "react", "next"] as const;

export const USAGE_DESCRIPTION = [
  "How to install and set up the Iconavo icon package in a project: install command, the line to add once, a complete example from the package documentation,",
  "tips on size, color and accessible labels, and licenses.",
  "Call it once per project before pasting icon code from get_icon or get_matching_set.",
].join(" ");

export const UsageInput = z.object({
  framework: z
    .enum(FRAMEWORKS)
    .default("html")
    .describe(
      "html (default) — the <iconavo-icon> web component from npm, for any framework or plain HTML with a bundler; script — the web component without a build step, two lines in <head>; react — React and Vite; next — Next.js App Router with server rendering",
    ),
  packageManager: z.enum(PACKAGE_MANAGERS).default("npm"),
});

export type UsageArgs = z.output<typeof UsageInput>;

export const UsageOutput = z.object({
  framework: z.enum(FRAMEWORKS),
  package: z.string(),
  version: z.string().describe("Current version of the Iconavo packages"),
  install: z
    .string()
    .optional()
    .describe("Install command (not needed for script)"),
  setup: z.string().describe("Code to add once per project"),
  example: z
    .string()
    .describe("Markdown: a complete example from the package documentation"),
  tips: z
    .string()
    .describe("Markdown: size and color, labels for screen readers"),
  licenses: z
    .string()
    .describe("Markdown: the package license and the license of each icon set"),
  docs: z.string(),
});

export type UsageResult = z.output<typeof UsageOutput>;

/** Тег в HTML — строка из примера README (раздел HTML). */
const TAG_EXAMPLE =
  '```html\n<a href="/"><iconavo-icon icon="lucide:house"></iconavo-icon> Home</a>\n```';

export function getUsage(deps: McpDeps, args: UsageArgs): CallToolResult {
  const { version, install, sections } = deps.usage;
  const react = args.framework === "react" || args.framework === "next";
  const pkg = react ? install.react.package : install.tag.package;
  const result: UsageResult = {
    framework: args.framework,
    package: pkg,
    version,
    ...(args.framework === "script"
      ? {}
      : { install: installCommand(args.packageManager, pkg) }),
    setup:
      args.framework === "script"
        ? install.script
        : react
          ? install.react.import
          : install.tag.import,
    example:
      args.framework === "script"
        ? sections.html
        : args.framework === "react"
          ? sections.react
          : args.framework === "next"
            ? sections.next
            : `\`\`\`js\n${install.tag.import}\n\`\`\`\n\n${TAG_EXAMPLE}`,
    tips: `### Size and color\n\n${sections.size}\n\n### A label for screen readers\n\n${sections.label}`,
    licenses: sections.license,
    docs: `${SITE_URL}/docs`,
  };
  const text = [
    `Iconavo ${result.package} ${result.version} — ${args.framework === "script" ? "without a build step" : args.framework}.`,
    "",
    ...(result.install === undefined
      ? []
      : ["Install:", "```sh", result.install, "```", ""]),
    args.framework === "script" ? "Add to <head>:" : "Add once:",
    "```",
    result.setup,
    "```",
    "",
    "Example:",
    result.example,
    "",
    result.tips,
    "",
    "### Licenses",
    "",
    result.licenses,
    "",
    `Documentation: ${result.docs}`,
  ].join("\n");
  return {
    content: [{ type: "text", text }],
    structuredContent: result,
  };
}
