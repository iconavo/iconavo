// Сборка файлов сумки в браузере (шаг 5 фазы 4, ADR-0042): рисунки — loadIcons ядра пачками edge API,
// полные тексты лицензий — /collection?info=true (getSet, память вкладки), указание авторства — /icon
// одной иконки набора: в нём части от других авторов (Feather у Lucide). Модуль грузится только по
// щелчку «Скачать» (import()), чтобы не утяжелять каждую страницу.

import {
  hasStrokeWidth,
  type IconData,
  iconData,
} from "@iconavo-ui/core/internal";
import { loadIcons } from "@iconavo-ui/react";
import { API } from "./api";
import {
  type BagIcon,
  type BagLook,
  type BagSet,
  bagArchive,
  spriteSvg,
} from "./bag-files";
import { getSet } from "./catalog";
import { splitName } from "./code";
import { attributionText, iconDetailsUrl, parseIconDetails } from "./icon";
import { zip } from "./zip";
// Хосты иконок — для ядра браузера (lib/iconavo.ts).
import "./iconavo";

/** Рисунки иконок сумки в её порядке; нет иконки или рисунок не читается — без неё. */
export async function bagIcons(names: readonly string[]): Promise<BagIcon[]> {
  const sets = await loadIcons([...names]);
  const icons: BagIcon[] = [];
  for (const name of names) {
    const [prefix, bare] = splitName(name);
    const set = sets.find((s) => s.prefix === prefix);
    let icon: IconData | null = null;
    try {
      icon = set === undefined ? null : iconData(set, bare);
    } catch {
      icon = null;
    }
    if (icon !== null) icons.push({ name, icon });
  }
  return icons;
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

/** Наборы сумки: название, указание авторства и полный текст лицензии. */
async function bagSets(icons: readonly BagIcon[]): Promise<BagSet[]> {
  const prefixes = [...new Set(icons.map((i) => splitName(i.name)[0]))];
  return Promise.all(
    prefixes.map(async (prefix) => {
      const sample =
        icons.find((i) => splitName(i.name)[0] === prefix)?.name ?? "";
      const [set, details] = await Promise.all([
        getSet(prefix),
        fetch(iconDetailsUrl(API, sample)).then(async (r) =>
          r.ok ? parseIconDetails(await r.json()) : undefined,
        ),
      ]);
      if (set === undefined || details === undefined) {
        throw new Error(`нет сведений о наборе ${prefix}`);
      }
      return {
        prefix,
        name: set.info.name,
        attribution: attributionText(details),
        license: set.info.license.text,
        ...(set.info.license.notice === undefined
          ? {}
          : { notice: set.info.license.notice }),
      };
    }),
  );
}

/** ZIP сумки. */
export async function bagZip(
  names: readonly string[],
  look: BagLook,
  when = new Date(),
): Promise<Blob> {
  const icons = await bagIcons(names);
  const sets = await bagSets(icons);
  return new Blob([zip(bagArchive(icons, sets, look, when), when)], {
    type: "application/zip",
  });
}

/** SVG-спрайт сумки. */
export async function bagSprite(
  names: readonly string[],
  look: BagLook,
): Promise<string> {
  const icons = await bagIcons(names);
  return spriteSvg(icons, await bagSets(icons), look);
}
