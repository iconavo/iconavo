// Вид кода иконки (ADR-0042, ADR-0044, ADR-0045): общая часть get_icon MCP-сервера и сетки выбора в чате
// (pick_icon) — они обязаны давать один и тот же код, это сверяют тесты. По умолчанию — веб-компонент
// (решение владельца 19 ноября 2026): он работает в любом фреймворке и в обычном HTML; React и чистый SVG —
// по просьбе ассистента. SVG совпадает побайтно с адресом SVG edge API с теми же настройками (тест сайта).
// Чистые функции без zod и без сети: схема полей — у сервера (apps/mcp/src/code.ts), а сетка в чате
// собирается для браузера.

import type { IconData } from "@iconavo-ui/core/internal";
import {
  type Applies,
  cssClassCode,
  cssSpanCode,
  fileComment,
  reactCode,
  svgFile,
  svgLink,
  tagCode,
} from "./code.js";
import type { IconDetails } from "./icon.js";
import { type Install, installCommand } from "./install.js";
import type { IconSettings, Quarter } from "./settings.js";

export const FORMATS = ["html", "react", "svg", "css"] as const;
export type Format = (typeof FORMATS)[number];

/** Виду нужен рисунок иконки: SVG и CSS-класс с маской; тегу и React — только имя. */
export const needsDrawing = (format: Format): format is "svg" | "css" =>
  format === "svg" || format === "css";

/** Вид кода словами — для текста ассистенту. */
export const FORMAT_TITLES: Record<Format, string> = {
  html: "web component <iconavo-icon>",
  react: "React <Icon> from @iconavo-ui/react",
  svg: "SVG markup",
  css: "CSS class with the icon as a mask, and an element that uses it",
};

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn"] as const;

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

/** Рисунок и сведения об авторстве — для кода SVG. */
export interface SvgSource {
  icon: IconData;
  details: Pick<IconDetails, "set" | "credits">;
}

/**
 * Код иконки нужного вида; для svg и css нужен рисунок (у svg — и сведения об авторстве), api — адрес
 * edge API. css — CSS-класс с маской и элемент с ним, как вид «CSS» панели сайта.
 */
export function lookCode(
  api: string,
  format: Format,
  name: string,
  settings: IconSettings,
  applies: Applies,
  install: Install,
  svg?: SvgSource,
): Code {
  if (format === "css") {
    if (svg === undefined) throw new Error("для CSS нужен рисунок иконки");
    return {
      code: `${cssClassCode(name, svg.icon, settings, applies)}

${cssSpanCode(name)}`,
    };
  }
  if (format === "svg") {
    if (svg === undefined) throw new Error("для SVG нужен рисунок иконки");
    return {
      code: svgFile(
        svg.icon,
        settings,
        applies,
        fileComment(name, svg.details),
      ).trimEnd(),
      svgUrl: svgLink(api, name, settings, applies),
    };
  }
  return {
    code:
      format === "react"
        ? reactCode(name, settings, applies, install)
        : tagCode(name, settings, applies),
  };
}
