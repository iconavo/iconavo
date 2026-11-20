// Данные для сетки выбора без сервера (шаг 11 фазы 4, ADR-0045): ответы pick_icon из настоящего каталога
// data/ — для страницы просмотра (pnpm mcp picker) и проверки в браузерах. Карточки — документы поискового
// индекса (loadSearchDocuments: те же стили, что у живого поиска), рисунки — из icons.json набора по
// каноническим именам, авторство — из info.json и metadata.json тем же правилом, что setSummary edge API.
// Порядок карточек — как ответил живой поиск на эти запросы 20 ноября 2026; сети здесь нет.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IconavoIconSet } from "@iconavo-ui/core";
import { type IconData, iconData } from "@iconavo-ui/core/internal";
import type {
  IconCredit,
  IconSetSummary,
  SearchDocument,
  Style,
} from "@iconavo-ui/search";
import type { Install } from "@iconavo-ui/snippets/install";
import type { Format } from "@iconavo-ui/snippets/look";
import {
  PICKER_META_KEY,
  type PickerCard,
  type PickerIcon,
  type PickerPayload,
  pickerPayload,
} from "@iconavo-ui/snippets/picker";
import { loadSearchDocuments } from "../meili/docs.js";
import type { SourceConfig } from "../sources/config.js";

/** Адреса в данных сетки — как у живого MCP-сервера. */
export const PICKER_API = "https://api.iconavo.dev";
export const PICKER_SITE = "https://iconavo.dev";

/** Возможности клиента, которые сетка спрашивает (McpUiHostCapabilities). */
export interface HostCaps {
  message?: Record<string, unknown>;
  updateModelContext?: Record<string, unknown>;
}

export interface PickerScenario {
  id: string;
  title: string;
  /** Ширина рамки, px. */
  width: number;
  hostContext: {
    theme: "light" | "dark";
    locale: string;
    platform: "web" | "desktop" | "mobile";
    displayMode: "inline";
  };
  caps: HostCaps;
  input: { query: string; format?: Format; sets?: string[] };
  result: {
    content: {
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }[];
    structuredContent: Record<string, unknown>;
    _meta: Record<string, unknown>;
  };
}

export interface ScenarioPlan {
  id: string;
  title: string;
  width: number;
  theme: "light" | "dark";
  locale: string;
  platform: "web" | "desktop" | "mobile";
  caps: HostCaps;
  query: string;
  format: Format;
  /** Только эти наборы — для живого сервера, как у вызова pick_icon. */
  sets?: string[];
  cards: string[];
}

const FULL_CAPS: HostCaps = {
  message: { text: {} },
  updateModelContext: { text: {} },
};

/** Сценарии страницы просмотра — то, что владелец смотрит до сервера (план шага 11). */
export const SCENARIOS: readonly ScenarioPlan[] = [
  {
    id: "share-en-light",
    title: "«share» — все наборы, светлая тема",
    width: 720,
    theme: "light",
    locale: "en-US",
    platform: "web",
    caps: FULL_CAPS,
    query: "share",
    format: "html",
    cards: [
      "lucide:share",
      "material-symbols:share",
      "ph:share",
      "tabler:share",
      "lucide:screen-share",
      "lucide:share-2",
      "material-symbols:document-share",
      "material-symbols:ios-share",
      "material-symbols:screen-share",
      "material-symbols:share-eta",
      "material-symbols:share-location",
      "material-symbols:share-off",
    ],
  },
  {
    id: "share-ru-dark",
    title:
      "«поделиться» — тёмная тема, русский чат (сетка — по-английски), сначала React",
    width: 720,
    theme: "dark",
    locale: "ru-RU",
    platform: "desktop",
    caps: FULL_CAPS,
    query: "поделиться",
    format: "react",
    cards: [
      "material-symbols:share",
      "tabler:share",
      "lucide:share-2",
      "ph:share-network",
      "material-symbols:document-share",
      "material-symbols:share-reviews",
      "tabler:share-3",
      "material-symbols:ios-share",
      "lucide:share",
      "tabler:mood-share",
      "tabler:link-share",
      "tabler:tag-share",
    ],
  },
  {
    id: "heart-emoji",
    title: "«heart» — только эмодзи: нет цвета и толщины",
    width: 720,
    theme: "light",
    locale: "en-US",
    platform: "web",
    caps: FULL_CAPS,
    query: "heart",
    format: "html",
    sets: ["fluent-emoji-flat"],
    cards: [
      "fluent-emoji-flat:anatomical-heart",
      "fluent-emoji-flat:heart-suit",
      "fluent-emoji-flat:white-heart",
      "fluent-emoji-flat:heart-with-ribbon",
      "fluent-emoji-flat:red-heart",
      "fluent-emoji-flat:beating-heart",
      "fluent-emoji-flat:purple-heart",
      "fluent-emoji-flat:growing-heart",
      "fluent-emoji-flat:heart-with-arrow",
      "fluent-emoji-flat:heart-decoration",
      "fluent-emoji-flat:heart-hands",
      "fluent-emoji-flat:green-heart",
    ],
  },
  {
    id: "basket-phone",
    title: "«корзина» — узкая рамка (телефон), сначала SVG",
    width: 360,
    theme: "light",
    locale: "ru-RU",
    platform: "mobile",
    caps: FULL_CAPS,
    query: "корзина",
    format: "svg",
    cards: [
      "material-symbols:shopping-basket",
      "lucide:shopping-basket",
      "material-symbols:shopping-cart",
      "tabler:basket",
      "tabler:shopping-cart",
      "ph:basket",
      "ph:shopping-cart",
      "tabler:shopping-cart-copy",
      "tabler:basket-plus",
      "lucide:shopping-cart",
      "tabler:basket-cog",
      "material-symbols:add-shopping-cart",
    ],
  },
  {
    id: "settings-no-message",
    title: "«settings» — клиент без сообщений и без контекста",
    width: 720,
    theme: "dark",
    locale: "en-US",
    platform: "web",
    caps: {},
    query: "settings",
    format: "html",
    cards: [
      "lucide:settings",
      "material-symbols:settings",
      "tabler:settings",
      "lucide:settings-2",
      "material-symbols:settings-accessibility",
      "material-symbols:settings-alert",
      "material-symbols:settings-applications",
      "material-symbols:settings-bluetooth",
      "material-symbols:settings-brightness",
      "material-symbols:settings-ethernet",
      "material-symbols:settings-heart",
      "material-symbols:settings-overscan",
    ],
  },
  {
    id: "empty",
    title: "«абракадабра» — ничего не нашлось",
    width: 720,
    theme: "light",
    locale: "ru-RU",
    platform: "web",
    caps: FULL_CAPS,
    query: "абракадабра",
    format: "html",
    cards: [],
  },
];

interface SetFiles {
  icons: IconavoIconSet;
  summary: IconSetSummary;
  credits: {
    name: string;
    author: string;
    license: string;
    url: string;
    icons: string[];
  }[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Набор, автор и лицензия — тем же правилом, что setSummary edge API (apps/api/src/icon.ts): его тест
 * сверяет оба на данных каталога.
 */
export function setSummaryOf(
  prefix: string,
  info: Record<string, unknown>,
  credits: SetFiles["credits"] = [],
): IconSetSummary {
  const author = isObject(info.author) ? info.author : {};
  const license = isObject(info.license) ? info.license : {};
  return {
    prefix,
    name: String(info.name ?? prefix),
    author: {
      name: String(author.name ?? ""),
      ...(typeof author.url === "string" ? { url: author.url } : {}),
    },
    license: {
      title: String(license.title ?? license.spdx ?? ""),
      spdx: String(license.spdx ?? ""),
      ...(typeof license.url === "string" ? { url: license.url } : {}),
    },
    palette: info.palette === true,
    ...(credits.length > 0
      ? {
          credits: credits.map((c) => ({
            name: c.name,
            author: c.author,
            license: c.license,
            url: c.url,
          })),
        }
      : {}),
  };
}

/** Каноническое имя: алиас — по цепочке до иконки (поворотов в данных нет, их останавливает раздача). */
export function canonicalName(
  set: IconavoIconSet,
  name: string,
): string | undefined {
  let current = name;
  for (let i = 0; i < 10; i++) {
    if (set.icons[current] !== undefined) return current;
    const parent = set.aliases?.[current]?.parent;
    if (parent === undefined) return undefined;
    current = parent;
  }
  return undefined;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function setFiles(dataDir: string, prefix: string): Promise<SetFiles> {
  const [icons, info, metadata] = await Promise.all([
    readJson(join(dataDir, prefix, "icons.json")),
    readJson(join(dataDir, prefix, "info.json")),
    readJson(join(dataDir, prefix, "metadata.json")),
  ]);
  const credits =
    isObject(metadata) && Array.isArray(metadata.credits)
      ? (metadata.credits as SetFiles["credits"])
      : [];
  return {
    icons: icons as IconavoIconSet,
    summary: setSummaryOf(prefix, info as Record<string, unknown>, credits),
    credits,
  };
}

const setOf = (name: string) => name.slice(0, name.indexOf(":"));
const bareOf = (name: string) => name.slice(name.indexOf(":") + 1);

export interface FixtureSource {
  configs: readonly SourceConfig[];
  dataDir: string;
  install: Install;
}

const loaded = new WeakMap<
  FixtureSource,
  Promise<Map<string, SearchDocument>>
>();

/** Документы поиска один раз на источник: их чтение — все наборы data/. */
function documentsOf(
  source: FixtureSource,
): Promise<Map<string, SearchDocument>> {
  let docs = loaded.get(source);
  if (docs === undefined) {
    docs = loadSearchDocuments(source.configs, source.dataDir).then(
      ({ docs: list, errors }) => {
        if (errors.length > 0) {
          throw new Error(
            `документы поиска не читаются: ${errors.map((e) => `${e.id}: ${e.message}`).join("; ")}`,
          );
        }
        return new Map(list.map((doc) => [doc.icon, doc]));
      },
    );
    loaded.set(source, docs);
  }
  return docs;
}

/** Данные сетки для карточек-оснований (имена набор:основа, как results[].icon живого поиска). */
export async function fixturePayload(
  source: FixtureSource,
  query: string,
  format: Format,
  bases: readonly string[],
  options: { size?: number; color?: string; style?: Style } = {},
): Promise<PickerPayload> {
  const byIcon = await documentsOf(source);
  const files = new Map<string, SetFiles>();
  for (const prefix of new Set(bases.map(setOf))) {
    files.set(prefix, await setFiles(source.dataDir, prefix));
  }
  const icons = new Map<string, PickerIcon>();
  const canonical = (full: string): string | undefined => {
    const set = files.get(setOf(full));
    if (set === undefined) return undefined;
    const name = canonicalName(set.icons, bareOf(full));
    if (name === undefined) return undefined;
    const key = `${setOf(full)}:${name}`;
    if (!icons.has(key)) {
      const data = iconData(set.icons, name) as IconData;
      const credits: IconCredit[] = set.credits
        .filter((c) => c.icons.includes(name))
        .map((c) => ({
          name: c.name,
          author: c.author,
          license: c.license,
          url: c.url,
        }));
      icons.set(key, { ...data, ...(credits.length > 0 ? { credits } : {}) });
    }
    return key;
  };
  const cards: PickerCard[] = [];
  for (const [i, base] of bases.entries()) {
    const doc = byIcon.get(base);
    if (doc === undefined)
      throw new Error(`нет карточки ${base} в документах поиска`);
    const styles: Partial<Record<Style, string>> = {};
    for (const [style, bare] of Object.entries(doc.styles)) {
      const name = canonical(`${doc.set}:${bare}`);
      if (name !== undefined) styles[style as Style] = name;
    }
    const shownBare =
      options.style === undefined
        ? bareOf(base)
        : (doc.styles[options.style] ?? bareOf(base));
    const shown = canonical(`${doc.set}:${shownBare}`);
    if (shown === undefined) throw new Error(`нет рисунка ${base}`);
    const style =
      (Object.entries(styles).find(([, name]) => name === shown)?.[0] as
        | Style
        | undefined) ?? null;
    cards.push({ n: i + 1, icon: shown, style, styles });
  }
  return pickerPayload({
    query,
    api: PICKER_API,
    site: PICKER_SITE,
    format,
    size: options.size ?? 24,
    ...(options.color === undefined ? {} : { color: options.color }),
    ...(options.style === undefined ? {} : { style: options.style }),
    cards,
    icons,
    sets: [...files.values()].map((f) => f.summary),
    install: source.install,
  });
}

/** Ответ инструмента вокруг данных сетки: текст — короткий, сетка его не показывает. */
function toolResult(payload: PickerPayload): PickerScenario["result"] {
  return {
    content: [
      {
        type: "text",
        text: `Fixture for "${payload.query}": ${payload.cards.length} icons.`,
      },
    ],
    structuredContent: { query: payload.query, count: payload.cards.length },
    _meta: { [PICKER_META_KEY]: payload },
  };
}

export async function pickerScenarios(
  source: FixtureSource,
): Promise<PickerScenario[]> {
  const out: PickerScenario[] = [];
  for (const plan of SCENARIOS) {
    const payload = await fixturePayload(
      source,
      plan.query,
      plan.format,
      plan.cards,
    );
    out.push(scenarioOf(plan, toolResult(payload)));
  }
  return out;
}

/** Сценарий страницы просмотра: рамка, контекст клиента и ответ инструмента. */
export function scenarioOf(
  plan: ScenarioPlan,
  result: PickerScenario["result"],
): PickerScenario {
  return {
    id: plan.id,
    title: plan.title,
    width: plan.width,
    hostContext: {
      theme: plan.theme,
      locale: plan.locale,
      platform: plan.platform,
      displayMode: "inline",
    },
    caps: plan.caps,
    input: {
      query: plan.query,
      format: plan.format,
      ...(plan.sets === undefined ? {} : { sets: plan.sets }),
    },
    result,
  };
}
