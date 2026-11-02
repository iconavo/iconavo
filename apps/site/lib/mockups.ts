// Мокапы страницы иконки (шаг 4 фазы 4, ADR-0041; утверждены владельцем 2 ноября 2026): выбранная иконка с
// настройками в восьми местах интерфейса, рядом — иконки витрины того же набора в том же стиле, без
// настроек. Здесь чистые части: соседи и подписи; рисует components/icon/IconMockups.tsx.

import { DICTIONARIES, type Dictionary, type Lang } from "./i18n";
import { bareName, type IconDetails } from "./icon";

/** Соседей в мокапе: панель вкладок, плитки, меню и панель инструментов берут до четырёх. */
export const NEIGHBOURS = 4;

/**
 * Витрина набора (samples, ADR-0017) — шесть иконок с одними смыслами по порядку: дом, поиск, настройки,
 * профиль, сердце, звезда. Подпись соседа — по его месту в витрине; соседи — сначала поиск, настройки,
 * профиль и сердце, как в утверждённом макете, а дом и звезда — на замену самой иконке.
 */
export const SLOT_LABELS = [
  "mockupHome",
  "mockupSearch",
  "mockupSettings",
  "mockupProfile",
  "mockupFavorites",
  "mockupRating",
] as const satisfies readonly (keyof Dictionary)[];
const SLOT_ORDER = [1, 2, 3, 4, 5, 0];

/** Суффикс стиля иконки относительно её карточки: у ph:house-fill с карточкой ph:house — «-fill». */
export function styleSuffix(icon: string, card: string | null): string {
  if (card === null || card === icon) return "";
  const base = bareName(card);
  const name = bareName(icon);
  return name.startsWith(`${base}-`) ? name.slice(base.length) : "";
}

/** Сосед: имя в стиле иконки, запасное — имя витрины как есть, и место в витрине. */
export interface Neighbour {
  styled: string;
  base: string;
  slot: number;
}

/** Соседи из витрины набора: без самой иконки и её карточки, в порядке SLOT_ORDER, не больше NEIGHBOURS. */
export function neighbourCandidates(
  samples: readonly string[],
  details: Pick<IconDetails, "icon" | "card">,
): Neighbour[] {
  const prefix = details.icon.slice(0, details.icon.indexOf(":"));
  const own = new Set([bareName(details.icon)]);
  if (details.card !== null) own.add(bareName(details.card));
  const suffix = styleSuffix(details.icon, details.card);
  const order = [
    ...SLOT_ORDER,
    ...[...samples.keys()].filter((i) => !SLOT_ORDER.includes(i)),
  ];
  return order
    .flatMap((slot) => {
      const sample = samples[slot];
      return sample === undefined || own.has(sample) ? [] : [{ sample, slot }];
    })
    .slice(0, NEIGHBOURS)
    .map(({ sample, slot }) => ({
      styled: `${prefix}:${sample}${suffix}`,
      base: `${prefix}:${sample}`,
      slot,
    }));
}

/** Сосед в мокапе: имя и подпись. */
export interface MockupNeighbour {
  icon: string;
  label: string;
}

/**
 * Соседи для мокапа: имя в стиле иконки, если оно есть в наборе, иначе имя витрины; подпись — по месту в
 * витрине, за её пределами — имя словами.
 */
export function pickNeighbours(
  candidates: readonly Neighbour[],
  existing: ReadonlySet<string>,
  lang: Lang,
): MockupNeighbour[] {
  return candidates.map((c) => {
    const key = SLOT_LABELS[c.slot];
    return {
      icon: existing.has(c.styled) ? c.styled : c.base,
      label: key === undefined ? words(c.base) : DICTIONARIES[lang][key],
    };
  });
}

/** Имя словами с большой буквы: lucide:arrow-up-right — «Arrow up right». */
function words(name: string): string {
  const text = bareName(name).replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Подпись иконки в мокапах: первый синоним на языке страницы с большой буквы, иначе имя карточки словами —
 * без суффикса стиля: у ph:house-fill — «House».
 */
export function mockupLabel(
  details: Pick<IconDetails, "icon" | "card" | "synonyms">,
  lang: Lang,
): string {
  const synonym = details.synonyms?.[lang][0];
  if (synonym === undefined) return words(details.card ?? details.icon);
  return synonym.charAt(0).toUpperCase() + synonym.slice(1);
}
