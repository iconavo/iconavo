// Код для вставки (ADR-0042, ADR-0044): те же функции, что у генератора сайта (packages/snippets) —
// тег, React и SVG-файл с комментарием об авторстве. По умолчанию — веб-компонент (решение владельца
// 19 ноября 2026): он работает в любом фреймворке и в обычном HTML; React и чистый SVG — по просьбе
// ассистента. SVG совпадает побайтно с адресом SVG edge API с теми же настройками (тест сайта).
// Чистая часть — @iconavo-ui/snippets/look: её же берёт сетка выбора в чате (pick_icon, ADR-0045), и код
// там обязан совпадать с get_icon. Здесь — схема полей zod и адрес edge API.

import type { Applies } from "@iconavo-ui/snippets/code";
import type { Install } from "@iconavo-ui/snippets/install";
import {
  type Code,
  FORMATS,
  type Format,
  lookCode,
  type SvgSource,
} from "@iconavo-ui/snippets/look";
import type { IconSettings } from "@iconavo-ui/snippets/settings";
import * as z from "zod";
import { API_ORIGIN } from "./config.js";

export {
  appliedOf,
  type Code,
  FORMAT_TITLES,
  FORMATS,
  type Format,
  jsxOnly,
  type Look,
  normalizeColor,
  PACKAGE_MANAGERS,
  type Setup,
  settingsOf,
  setupFor,
} from "@iconavo-ui/snippets/look";

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Поля вида иконки — общие у get_icon, get_matching_set и pick_icon. */
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

/** Код иконки нужного вида; для svg нужен рисунок и сведения об авторстве. */
export const codeOf = (
  format: Format,
  name: string,
  settings: IconSettings,
  applies: Applies,
  install: Install,
  svg?: SvgSource,
): Code => lookCode(API_ORIGIN, format, name, settings, applies, install, svg);
