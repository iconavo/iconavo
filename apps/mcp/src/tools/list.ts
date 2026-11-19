// list_sets (ADR-0011, ADR-0044): наборы иконок с авторами, лицензиями и стилями — те же данные, что у
// адресов каталога edge API (/collections, /collection?info=true; шаг 2 фазы 4): оглавление каталога
// раздачи в R2. Полные тексты лицензий — только по просьбе: у Material Symbols это 11 тысяч знаков.

import { STYLES } from "@iconavo-ui/search";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod";
import { catalogOf } from "../../../api/src/catalog.js";
import { setSummary } from "../../../api/src/icon.js";
import { SITE_URL } from "../config.js";
import type { McpDeps } from "../context.js";
import { toolError } from "../errors.js";
import { SetInfoSchema, StyleSchema } from "../schemas.js";
import { licenseLine } from "../sets.js";

export const LIST_NAME = "list_sets";

export const LIST_DESCRIPTION = [
  "List the icon sets: name, prefix, number of icons, author, license with a link, styles, whether the set is multicolor, grid size and sample icons.",
  "Use a prefix as sets/set in search_icons and get_matching_set. All sets are open source and allow commercial use with attribution.",
].join(" ");

/** Разрешительные лицензии наборов (ADR-0017): можно в коммерческих проектах. */
const PERMISSIVE = new Set(["MIT", "ISC", "Apache-2.0"]);

export const ListInput = z.object({
  licenseText: z
    .boolean()
    .default(false)
    .describe("Include the full license text of each set (long)"),
});

export type ListArgs = z.output<typeof ListInput>;

export const ListOutput = z.object({
  sets: z.array(
    SetInfoSchema.extend({
      total: z.number().int().describe("Number of icons"),
      height: z.number().optional().describe("Grid size in pixels"),
      styles: z.array(StyleSchema),
      samples: z.array(z.string()),
      version: z
        .string()
        .optional()
        .describe("Version of the set by its author"),
      commercialUse: z.boolean(),
      page: z.string(),
      licenseText: z.string().optional(),
    }),
  ),
});

export type ListResult = z.output<typeof ListOutput>;

const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

export async function listSets(
  deps: McpDeps,
  args: ListArgs,
): Promise<CallToolResult> {
  try {
    const manifest = await deps.routes.manifest();
    const index = await deps.routes.catalogIndex(catalogOf(manifest));
    const sets: ListResult["sets"] = [...index.sets].map(([prefix, entry]) => {
      const info = entry.info;
      const summary = setSummary(prefix, entry);
      const samples = Array.isArray(info.samples)
        ? info.samples.filter((s): s is string => typeof s === "string")
        : [];
      const licenseText = text(entry.license.text);
      return {
        ...summary,
        total: typeof info.total === "number" ? info.total : 0,
        ...(typeof info.height === "number" ? { height: info.height } : {}),
        // Порядок общей шкалы (ADR-0052), а не порядок ключей оглавления.
        styles: STYLES.filter((style) => entry.styles?.[style] !== undefined),
        samples: samples.map((s) => `${prefix}:${s}`),
        ...(text(info.version) === undefined
          ? {}
          : { version: text(info.version) as string }),
        commercialUse: PERMISSIVE.has(summary.license.spdx),
        page: `${SITE_URL}/${prefix}`,
        ...(args.licenseText && licenseText !== undefined
          ? { licenseText }
          : {}),
      };
    });
    const result: ListResult = { sets };
    const lines = [
      `${sets.length} icon sets${sets.every((s) => s.commercialUse) ? ", all allow commercial use with attribution" : ""}:`,
      ...sets.map(
        (s) =>
          `- ${licenseLine(s)} ${s.total.toLocaleString("en-US")} icons; ${s.palette ? "multicolor" : "monochrome"}; styles: ${s.styles.join(", ") || "—"}; samples: ${s.samples.slice(0, 3).join(", ")}.`,
      ),
    ];
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: result,
    };
  } catch (e) {
    return toolError(e, deps.log);
  }
}
