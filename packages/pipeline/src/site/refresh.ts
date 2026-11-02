// Сброс кэша страниц по наборам (шаг 4 фазы 4, ADR-0039). pnpm site --refresh сравнивает отпечаток
// содержимого каждого набора на его живых страницах (метка iconavo-content, оба языка) с оглавлением
// каталога раздачи: manifest.json → catalog/{хэш}.json на cdn.iconavo.dev; тот же отпечаток отдаёт edge API
// заголовком X-Iconavo-Content. Другой отпечаток — набор «устарел»: workflow «Сайт» сбросит метки
// set-{набор} и catalog (vercel cache invalidate — ключ только у задачи окружения site). Страницы набора
// нет (404) — набор новый: нужна пересборка сайта. С --wait команда ждёт, пока страницы сброшенных наборов
// и страница иконки из витрины каждого покажут свежий отпечаток и время сборки не раньше сброса. Только
// открытые адреса, ключи не нужны.

import { catalogIndexKey, catalogIndexSchema } from "../cdn/catalog.js";
import { manifestSchema } from "../cdn/files.js";
import {
  CATALOG_TAG,
  CONTENT_META,
  INVALIDATE_TAGS,
  LIVE_CDN,
  REFRESH_POLL_MS,
  REFRESH_SKEW_MS,
  RENDERED_META,
} from "./config.js";
import { metaOf } from "./crawl.js";

/** Набор в оглавлении каталога: отпечаток содержимого и первая иконка витрины. */
export interface CatalogSet {
  content: string;
  sample?: string;
}

/** Живая страница: код ответа и метки. */
export interface LivePage {
  path: string;
  status: number;
  content?: string;
  rendered?: string;
}

export type RefreshState = "fresh" | "stale" | "missing";

export interface RefreshRow {
  id: string;
  expected: string;
  pages: LivePage[];
  state: RefreshState;
}

/** Страницы набора, по которым видна свежесть: страница набора на обоих языках. */
export const setPaths = (id: string) => [`/${id}`, `/ru/${id}`];

/**
 * Состояние набора по его страницам: какой-то нет (404) — новый набор, нужна пересборка; отпечаток не
 * тот или метки нет (страница собрана до сброса по наборам) — устарел; иначе свежий.
 */
export function refreshState(
  pages: LivePage[],
  expected: string,
): RefreshState {
  if (pages.some((p) => p.status === 404)) return "missing";
  return pages.every((p) => p.status === 200 && p.content === expected)
    ? "fresh"
    : "stale";
}

/**
 * Страница после сброса: ответила 200 и отпечаток — из оглавления. С since — ещё и собрана не раньше
 * сброса (с допуском на расхождение часов Vercel и машины GitHub): так видна свежесть после «сбросить все
 * наборы», когда отпечатки не менялись. Без since время не смотрится: выкладка кода между сравнением и
 * сбросом даёт свежие страницы, собранные чуть раньше сброса.
 */
export function pageRefreshed(
  page: LivePage,
  expected: string,
  since?: number,
): boolean {
  if (page.status !== 200 || page.content !== expected) return false;
  if (since === undefined) return true;
  const rendered = Date.parse(page.rendered ?? "");
  return Number.isFinite(rendered) && rendered >= since - REFRESH_SKEW_MS;
}

/**
 * Метки для сброса устаревших наборов — группами не больше INVALIDATE_TAGS, через запятую, как их ждёт
 * vercel cache invalidate --tag; catalog — один раз, в первой группе.
 */
export function invalidateGroups(stale: readonly string[]): string[] {
  if (stale.length === 0) return [];
  const tags = [CATALOG_TAG, ...stale.map((id) => `set-${id}`)];
  const groups: string[] = [];
  for (let i = 0; i < tags.length; i += INVALIDATE_TAGS) {
    groups.push(tags.slice(i, i + INVALIDATE_TAGS).join(","));
  }
  return groups;
}

/**
 * Ответ адреса: сбой сети и ответ 5xx — ещё две попытки через pauseMs. Запуск из-за моргнувшей раздачи
 * краснеть не должен: 2 ноября 2026 манифест cdn.iconavo.dev один раз ответил 500, а через минуту — 200.
 * После третьей попытки 5xx возвращается как есть.
 */
export async function getWithRetry(
  url: string,
  pauseMs = 2_000,
): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, pauseMs));
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status < 500 || attempt === 2) return response;
      await response.arrayBuffer();
      last = new Error(`ответ ${response.status}`);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`${url} не ответил: ${(last as Error).message}`);
}

const get = (url: string) => getWithRetry(url);

/** Наборы из оглавления каталога раздачи: отпечаток содержимого и первая иконка витрины. */
export async function catalogSets(
  cdn: string = LIVE_CDN,
): Promise<Record<string, CatalogSet>> {
  const manifest = await get(`${cdn}/manifest.json`);
  if (!manifest.ok)
    throw new Error(`${cdn}/manifest.json ответил ${manifest.status}`);
  const { catalog } = manifestSchema.parse(await manifest.json());
  if (catalog === undefined)
    throw new Error("в манифесте раздачи нет поля catalog");
  const url = `${cdn}/${catalogIndexKey(catalog)}`;
  const index = await get(url);
  if (!index.ok) throw new Error(`${url} ответил ${index.status}`);
  const { sets } = catalogIndexSchema.parse(await index.json());
  return Object.fromEntries(
    Object.entries(sets).map(([id, set]) => {
      const sample = set.info.samples?.[0];
      return [
        id,
        { content: set.content, ...(sample === undefined ? {} : { sample }) },
      ];
    }),
  );
}

/** Живая страница сайта: код ответа и метки отпечатка и времени сборки. */
export async function livePage(base: string, path: string): Promise<LivePage> {
  const response = await get(`${base}${path}`);
  const page: LivePage = { path, status: response.status };
  if (response.status !== 200) return page;
  const html = await response.text();
  const content = metaOf(html, CONTENT_META);
  const rendered = metaOf(html, RENDERED_META);
  return {
    ...page,
    ...(content === undefined ? {} : { content }),
    ...(rendered === undefined ? {} : { rendered }),
  };
}

/** Сравнение живого сайта с оглавлением: состояние каждого набора; all — все наборы со страницей устарели. */
export async function compareSite(
  base: string,
  sets: Record<string, CatalogSet>,
  all = false,
): Promise<RefreshRow[]> {
  const rows: RefreshRow[] = [];
  for (const [id, set] of Object.entries(sets)) {
    const pages: LivePage[] = [];
    for (const path of setPaths(id)) pages.push(await livePage(base, path));
    const state = refreshState(pages, set.content);
    rows.push({
      id,
      expected: set.content,
      pages,
      state: all && state === "fresh" ? "stale" : state,
    });
  }
  return rows;
}

export interface WaitResult {
  done: boolean;
  /** Страницы, которые так и не обновились, с тем, что на них. */
  pending: LivePage[];
  seconds: number;
}

/**
 * Ожидание после сброса: страницы наборов на обоих языках и страница первой иконки витрины каждого
 * отвечают отпечатком из оглавления, а с rendered — ещё и собраны не раньше since. Первый запрос после
 * сброса Vercel отдаёт прежнюю страницу и собирает новую в фоне (stale-while-revalidate), поэтому опрос
 * повторяется.
 */
export async function waitRefreshed(o: {
  base: string;
  sets: Record<string, CatalogSet>;
  ids: readonly string[];
  since: number;
  /** Смотреть и время сборки — после «сбросить все наборы» (--all). */
  rendered?: boolean;
  timeoutMs: number;
  pollMs?: number;
  log?: (line: string) => void;
}): Promise<WaitResult> {
  const started = Date.now();
  const paths = o.ids.flatMap((id) => {
    const sample = o.sets[id]?.sample;
    return [
      ...setPaths(id).map((path) => ({ id, path })),
      ...(sample === undefined ? [] : [{ id, path: `/${id}/${sample}` }]),
    ];
  });
  let pending: LivePage[] = [];
  for (;;) {
    pending = [];
    for (const { id, path } of paths) {
      const page = await livePage(o.base, path);
      const expected = o.sets[id]?.content ?? "";
      const since = o.rendered ? o.since : undefined;
      if (!pageRefreshed(page, expected, since)) pending.push(page);
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    if (pending.length === 0) return { done: true, pending, seconds };
    if (Date.now() - started >= o.timeoutMs) {
      return { done: false, pending, seconds };
    }
    o.log?.(
      `  ${seconds} с: ждут ${pending.length} из ${paths.length} — ${pending
        .slice(0, 3)
        .map((p) => p.path)
        .join(", ")}${pending.length > 3 ? "…" : ""}`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, o.pollMs ?? REFRESH_POLL_MS),
    );
  }
}

/** Что на странице — для таблицы: код, отпечаток и время сборки. */
export function describePage(page: LivePage): string {
  if (page.status !== 200) return `${page.path}: ответ ${page.status}`;
  return `${page.path}: ${page.content ?? "без отпечатка"}, собрана ${page.rendered ?? "—"}`;
}
