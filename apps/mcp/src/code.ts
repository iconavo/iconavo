// Код для вставки (ADR-0042, ADR-0044): те же функции, что у генератора сайта (packages/snippets) —
// тег, React и SVG-файл с комментарием об авторстве. По умолчанию — веб-компонент (решение владельца
// 19 ноября 2026): он работает в любом фреймворке и в обычном HTML; React и чистый SVG — по просьбе
// ассистента. SVG совпадает побайтно с адресом SVG edge API с теми же настройками (тест сайта).

import type { IconData } from "@iconavo-ui/core/internal";
import {
  type Applies,
  fileComment,
  reactCode,
  svgFile,
  svgLink,
  tagCode,
} from "@iconavo-ui/snippets/code";
import type { IconDetails } from "@iconavo-ui/snippets/icon";
import { type Install, installCommand } from "@iconavo-ui/snippets/install";
import type { IconSettings, Quarter } from "@iconavo-ui/snippets/settings";
import * as z from "zod";
import { API_ORIGIN } from "./config.js";

export const FORMATS = ["html", "react", "svg"] as const;
export type Format = (typeof FORMATS)[number];

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"] as const;

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Поля вида иконки — общие у get_icon и get_matching_set. */
export const LookFields = {
  format: z
    .enum(FORMATS)
    .default("html")
    .describe(
      "html (default) — the <iconavo-icon> web component: works in any framework and in plain HTML; react — <Icon> from @iconavo-ui/react for React and Next.js; svg — raw SVG markup without the package, only if the user explicitly asks for SVG",
    ),
  size: z.number().int().min(8).max(512).default(24).describe("Size in pixels"),
  color: z
    .string()
    .regex(HEX)
    .optional()
    .describe(
      "Hex color such as #e11d48; omit to inherit the text color (currentColor), which is usually best",
    ),
  strokeWidth: z
    .number()
    .min(0.25)
    .max(8)
    .optional()
    .describe(
      "Line width in icon grid units, e.g. 1.5; changes only line icons such as Lucide",
    ),
};

export interface Look {
  format: Format;
  size: number;
  color?: string | undefined;
  strokeWidth?: number | undefined;
  rotate?: 0 | 90 | 180 | 270 | undefined;
}

/** #rgb и #rrggbb → #rrggbb строчными, как у генератора сайта. */
export function normalizeColor(color: string): string {
  const hex = color.slice(1).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
}

export function settingsOf(look: Look): IconSettings {
  return {
    size: look.size,
    ...(look.color === undefined ? {} : { color: normalizeColor(look.color) }),
    ...(look.strokeWidth === undefined ? {} : { stroke: look.strokeWidth }),
    rotate: ((look.rotate ?? 0) / 90) as Quarter,
    hflip: false,
    vflip: false,
  };
}

/** Что из настроек применилось, и почему остальное — нет: ассистент скажет человеку. */
export function appliedOf(
  look: Look,
  applies: Applies,
  setName: string,
): {
  applied: {
    size: number;
    color?: string;
    strokeWidth?: number;
    rotate?: number;
  };
  notes: string[];
} {
  const notes: string[] = [];
  if (look.color !== undefined && applies.palette) {
    notes.push(`Color is not applied: ${setName} is a multicolor set.`);
  }
  if (look.strokeWidth !== undefined && !applies.strokes) {
    notes.push(
      "Stroke width is not applied: this icon has no lines that change with it.",
    );
  }
  return {
    applied: {
      size: look.size,
      ...(look.color !== undefined && !applies.palette
        ? { color: normalizeColor(look.color) }
        : {}),
      ...(look.strokeWidth !== undefined && applies.strokes
        ? { strokeWidth: look.strokeWidth }
        : {}),
      ...(look.rotate ? { rotate: look.rotate } : {}),
    },
    notes,
  };
}

export interface Setup {
  /** Команда установки пакета. */
  install: string;
  /** Строка подключения в коде. */
  import: string;
  /** Без сборщика: строки <script> с хэшем и <style> из README (только веб-компонент). */
  script?: string;
}

export function setupFor(
  format: "html" | "react",
  install: Install,
  pm: (typeof PACKAGE_MANAGERS)[number] = "npm",
): Setup {
  return format === "html"
    ? {
        install: installCommand(pm, install.tag.package),
        import: install.tag.import,
        script: install.script,
      }
    : {
        install: installCommand(pm, install.react.package),
        import: install.react.import,
      };
}

/** Элемент без строки импорта: <Icon … /> из reactCode — для списка иконок с общей настройкой. */
export const jsxOnly = (code: string): string =>
  code.slice(code.indexOf("\n\n") + 2);

export interface Code {
  code: string;
  /** Тот же SVG адресом edge API (только svg). */
  svgUrl?: string;
}

/** Код иконки нужного вида; для svg нужен рисунок и сведения об авторстве. */
export function codeOf(
  format: Format,
  name: string,
  settings: IconSettings,
  applies: Applies,
  install: Install,
  svg?: { icon: IconData; details: Pick<IconDetails, "set" | "credits"> },
): Code {
  if (format === "svg") {
    if (svg === undefined) throw new Error("для SVG нужен рисунок иконки");
    return {
      code: svgFile(
        svg.icon,
        settings,
        applies,
        fileComment(name, svg.details),
      ).trimEnd(),
      svgUrl: svgLink(API_ORIGIN, name, settings, applies),
    };
  }
  return {
    code:
      format === "react"
        ? reactCode(name, settings, applies, install)
        : tagCode(name, settings, applies),
  };
}
