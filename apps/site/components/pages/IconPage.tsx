import {
  hasStrokeWidth,
  type IconData,
  iconData,
} from "@iconavo-ui/core/internal";
import { type IconavoIconSet, IconavoProvider } from "@iconavo-ui/react";
import type { Card } from "@iconavo-ui/search";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { API } from "../../lib/api";
import {
  categoriesOf,
  getReleases,
  getSet,
  getSets,
  revisionLabel,
  type SetData,
  setCards,
  setTag,
} from "../../lib/catalog";
import { setMetas } from "../../lib/catalog-view";
import { formatDate } from "../../lib/format";
import { DICTIONARIES, href, type Lang } from "../../lib/i18n";
import {
  bareName,
  type IconDetails,
  iconDetailsUrl,
  iconPagePath,
  isIconName,
  parseIconDetails,
} from "../../lib/icon";
import {
  type IconDates,
  type IconPageData,
  iconDates,
  resolveAlias,
  styleTiles,
} from "../../lib/icon-page";
import { loadIconPageIcons } from "../../lib/icons";
import {
  mockupLabel,
  type Neighbour,
  neighbourCandidates,
  pickNeighbours,
} from "../../lib/mockups";
import { IconView } from "../iconpage/IconView";

/** Подписи оттенков кожи Fluent Emoji — в порядке карточки: основа и пять оттенков. */
const TONE_KEYS = [
  "iconToneDefault",
  "iconToneLight",
  "iconToneMediumLight",
  "iconToneMedium",
  "iconToneMediumDark",
  "iconToneDark",
] as const;

/** Соседей в «In context»: навигация и меню берут по два. */
const CONTEXT_NEIGHBOURS = 2;

/**
 * Сведения /icon edge API — теги, похожие, описание и Feather. Нужен поиск Meilisearch; не ответил —
 * страница собирается без них, а браузер спросит их сам (решение владельца 13 ноября 2026). Метка
 * set-{набор} — для сброса кэша по набору (ADR-0039); без cache: ответ не ложится в кэш запросов.
 */
async function tryDetails(
  name: string,
  prefix: string,
): Promise<IconDetails | undefined> {
  try {
    const res = await fetch(iconDetailsUrl(API, name), {
      next: { tags: [setTag(prefix)] },
    });
    if (!res.ok) return undefined;
    const details = parseIconDetails(await res.json());
    return details?.icon === name ? details : undefined;
  } catch {
    return undefined;
  }
}

type Loaded =
  | { kind: "redirect"; to: string }
  | {
      kind: "icon";
      name: string;
      set: SetData;
      hidden: boolean;
      card: Card | undefined;
      data: IconData;
      icons: IconavoIconSet[];
      candidates: Neighbour[];
      existing: Set<string>;
      dates: IconDates;
      details: IconDetails | undefined;
      setNames: Record<string, string>;
    };

/**
 * Данные страницы — из каталога наборов: /collection с полной лицензией, /changelog набора, пачка
 * рисунков и /collections (названия наборов похожих). Один раз на сборку страницы (React cache убирает
 * повтор из generateMetadata); у всех запросов — метка set-{набор}: выпуск другого набора страницу не
 * сбрасывает. Набора или имени нет — undefined (404); старое имя — переход на основное.
 */
const load = cache(async (name: string): Promise<Loaded | undefined> => {
  const prefix = name.slice(0, name.indexOf(":"));
  const bare = bareName(name);
  const set = await getSet(prefix);
  if (set === undefined) return undefined;
  const target = resolveAlias(set.aliases, bare);
  if (target === undefined) return undefined;
  if (target !== bare) return { kind: "redirect", to: `${prefix}:${target}` };
  const hidden = set.hidden?.includes(bare) === true;
  const cards = setCards(set);
  const base = cards.cardOf.get(bare);
  const card =
    base === undefined ? undefined : cards.cards.find((c) => c.base === base);
  if (!hidden && card === undefined) return undefined;

  const full = (n: string) => `${prefix}:${n}`;
  const own =
    card === undefined
      ? [name]
      : [name, ...[card.base, ...card.variants, ...card.tones].map(full)];
  const candidates =
    card === undefined
      ? []
      : neighbourCandidates(set.info.samples ?? [], {
          icon: name,
          card: full(card.base),
        });
  const [loaded, releases, details, sets] = await Promise.all([
    loadIconPageIcons(
      own,
      candidates.flatMap((c) => [c.styled, c.base]),
    ),
    getReleases(setTag(prefix), prefix),
    tryDetails(name, prefix),
    getSets(setTag(prefix)),
  ]);
  const ownSet = loaded.icons.find((s) => s.prefix === prefix);
  const data = ownSet === undefined ? null : iconData(ownSet, bare);
  if (data === null) {
    throw new Error(`СТОП: рисунок ${name} не читается (ADR-0024)`);
  }
  return {
    kind: "icon",
    name,
    set,
    hidden,
    card,
    data,
    icons: loaded.icons,
    candidates,
    existing: loaded.existing,
    dates: iconDates(prefix, bare, releases),
    details,
    setNames: Object.fromEntries(
      Object.entries(sets).map(([id, info]) => [id, info.name]),
    ),
  };
});

/** Заголовок, описание и метки набора (версия, содержимое, время сборки); скрытая — не для поисковиков. */
export async function iconMetadata(
  lang: Lang,
  prefix: string,
  icon: string,
): Promise<Metadata> {
  const name = `${prefix}:${icon}`;
  if (!isIconName(name)) return {};
  const got = await load(name);
  if (got === undefined || got.kind === "redirect") return {};
  const t = DICTIONARIES[lang];
  const fill = (text: string) =>
    text.replace("{name}", icon).replace("{set}", got.set.info.name);
  return {
    title: fill(t.iconPageTitle),
    description:
      got.details?.description?.[lang] ?? fill(t.iconPageDescription),
    ...(got.hidden ? { robots: { index: false, follow: false } } : {}),
    other: setMetas(got.set.version, got.set.content),
  };
}

/**
 * Страница иконки /{набор}/{иконка} по макету Figma «Страница иконки» (редизайн, шаг 4): превью с
 * сеткой, размеры, мета-строка, теги и категории, Size и Color, копирование в пяти форматах,
 * скачивание и сумка, другие стили и даты; вкладки Similar icons, Code и In context. Создаётся при
 * первом открытии и хранится в кэше (ADR-0039). Старое имя — постоянный переход на основное, скрытая
 * иконка — состояние Removed. Иконка, её варианты и соседи — в серверном HTML (без мигания), похожие из
 * других наборов догружает браузер.
 */
export async function IconPage({
  lang,
  prefix,
  icon,
}: {
  lang: Lang;
  prefix: string;
  icon: string;
}) {
  const name = `${prefix}:${icon}`;
  if (!isIconName(name)) notFound();
  const got = await load(name);
  if (got === undefined) notFound();
  if (got.kind === "redirect") {
    permanentRedirect(href(lang, iconPagePath(got.to)));
  }
  const t = DICTIONARIES[lang];
  const { set, card, details, dates } = got;
  const full = (n: string) => `${prefix}:${n}`;
  const tiles: IconPageData["tiles"] =
    card === undefined
      ? { kind: "styles", items: [] }
      : card.tones.length > 0
        ? {
            kind: "tones",
            items: [card.base, ...card.tones].map((n, i) => ({
              name: full(n),
              label: t[TONE_KEYS[i] ?? "iconToneDefault"],
            })),
          }
        : {
            kind: "styles",
            items: styleTiles(card, set).map((tile) => ({
              name: full(tile.name),
              label: tile.label,
            })),
          };
  const page: IconPageData = {
    icon: name,
    card: card === undefined ? null : full(card.base),
    hidden: got.hidden,
    set: {
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
      ...(details?.set.credits === undefined
        ? {}
        : { credits: details.set.credits }),
    },
    data: got.data,
    strokes: hasStrokeWidth(got.data.body),
    categories: categoriesOf(set)
      .filter(
        (c) =>
          c.names.includes(icon) ||
          (card !== undefined && c.names.includes(card.base)),
      )
      .map(({ title, slug }) => ({ title, slug })),
    tiles,
    dates: {
      ...(dates.added === undefined
        ? {}
        : { added: formatDate(lang, dates.added) }),
      ...(dates.changed === undefined
        ? {}
        : { changed: formatDate(lang, dates.changed) }),
      ...(dates.removed === undefined
        ? {}
        : { removed: formatDate(lang, dates.removed.date) }),
    },
    ...(dates.removed === undefined
      ? {}
      : { removedIn: revisionLabel(dates.removed.revision) }),
    ...(details === undefined ? {} : { details }),
    label: mockupLabel(
      {
        icon: name,
        card: card === undefined ? null : full(card.base),
        synonyms: details?.synonyms ?? null,
      },
      lang,
    ),
    neighbours: pickNeighbours(got.candidates, got.existing, lang).slice(
      0,
      CONTEXT_NEIGHBOURS,
    ),
    setNames: got.setNames,
  };
  return (
    <main id="content" className="page icon-page">
      <IconavoProvider icons={got.icons}>
        <IconView key={name} lang={lang} page={page} />
      </IconavoProvider>
    </main>
  );
}
