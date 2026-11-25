// Сборка файлов сумки в браузере (шаг 5 фазы 4, ADR-0042): рисунки — loadIcons ядра пачками edge API,
// полные тексты лицензий — /collection?info=true (getSet, память вкладки), указание авторства — /icon
// одной иконки набора: в нём части от других авторов (Feather у Lucide); /icon не ответил, ответил
// криво или молчит дольше DETAILS_TIMEOUT_MS — указание авторства из каталога наборов (ревизия фазы 5,
// С-12, С-24). Модуль грузится только по щелчку «Скачать» (import()), чтобы не утяжелять каждую страницу.

import { hasStrokeWidth } from "@iconavo-ui/core/internal";
import { loadIcons } from "@iconavo-ui/react";
import { API } from "./api";
import {
  type BagIcon,
  type BagLook,
  type BagSet,
  bagArchive,
  pickIcons,
  spriteSvg,
} from "./bag-files";
import { getSet } from "./catalog";
import { splitName } from "./code";
import {
  attributionText,
  type IconDetails,
  iconDetailsUrl,
  parseIconDetails,
} from "./icon";
import { zip } from "./zip";
// Хосты иконок — для ядра браузера (lib/iconavo.ts).
import "./iconavo";

/** Сколько ждать /icon, прежде чем собрать указание авторства из каталога: столько же, сколько попытка ядра. */
export const DETAILS_TIMEOUT_MS = 5_000;

/** Рисунки иконок сумки в её порядке и имена, которые не загрузились (pickIcons). */
export async function bagIcons(
  names: readonly string[],
): Promise<{ icons: BagIcon[]; missing: string[] }> {
  return pickIcons(names, await loadIcons([...names]));
}

/**
 * Сведения /icon об иконке; сбой сети, ответ не 200, не JSON или не по форме, тишина дольше
 * DETAILS_TIMEOUT_MS — undefined: скачивание не ломается и не висит (ревизия фазы 5, С-12).
 */
export async function detailsOf(
  name: string,
  timeout = DETAILS_TIMEOUT_MS,
): Promise<IconDetails | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(iconDetailsUrl(API, name), {
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return parseIconDetails(await response.json());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Что применимо к сумке: свой цвет — есть монохромные, толщина — есть линии. */
export function bagApplies(icons: readonly BagIcon[]): {
  color: boolean;
  stroke: boolean;
} {
  return {
    color: icons.some((i) => i.icon.body.includes("currentColor")),
    stroke: icons.some((i) => hasStrokeWidth(i.icon.body)),
  };
}

/**
 * Наборы сумки: название, указание авторства и полный текст лицензии. Части набора от других авторов
 * (Feather у Lucide) знает только /icon — поиск Meilisearch; не ответил — указание авторства собирается
 * из каталога наборов без них (решение владельца 13 ноября 2026: сайт работает и без поиска), а полный
 * текст лицензии в ZIP их всё равно называет.
 */
async function bagSets(icons: readonly BagIcon[]): Promise<BagSet[]> {
  const prefixes = [...new Set(icons.map((i) => splitName(i.name)[0]))];
  return Promise.all(
    prefixes.map(async (prefix) => {
      const sample =
        icons.find((i) => splitName(i.name)[0] === prefix)?.name ?? "";
      const [set, details] = await Promise.all([
        getSet(prefix),
        detailsOf(sample),
      ]);
      if (set === undefined) {
        throw new Error(`нет сведений о наборе ${prefix}`);
      }
      const summary = details?.set ?? {
        prefix,
        name: set.info.name,
        author: set.info.author,
        license: {
          title: set.info.license.title,
          spdx: set.info.license.spdx,
          ...(set.info.license.url === undefined
            ? {}
            : { url: set.info.license.url }),
        },
        palette: set.info.palette,
      };
      return {
        prefix,
        name: set.info.name,
        attribution: attributionText({ set: summary }),
        license: set.info.license.text,
        ...(set.info.license.notice === undefined
          ? {}
          : { notice: set.info.license.notice }),
      };
    }),
  );
}

/**
 * Итог сборки: файл — нет, если не загрузилась ни одна иконка; сколько иконок в нём (для аналитики,
 * ревизия фазы 5, С-29) и какие не вошли — их сайт называет человеку (С-11).
 */
export interface BagExport<T> {
  file: T | undefined;
  count: number;
  missing: string[];
}

/** ZIP сумки. */
export async function bagZip(
  names: readonly string[],
  look: BagLook,
  when = new Date(),
): Promise<BagExport<Blob>> {
  const { icons, missing } = await bagIcons(names);
  if (icons.length === 0) return { file: undefined, count: 0, missing };
  const sets = await bagSets(icons);
  const file = new Blob([zip(bagArchive(icons, sets, look, when), when)], {
    type: "application/zip",
  });
  return { file, count: icons.length, missing };
}

/** SVG-спрайт сумки. */
export async function bagSprite(
  names: readonly string[],
  look: BagLook,
): Promise<BagExport<string>> {
  const { icons, missing } = await bagIcons(names);
  if (icons.length === 0) return { file: undefined, count: 0, missing };
  const file = spriteSvg(icons, await bagSets(icons), look);
  return { file, count: icons.length, missing };
}
