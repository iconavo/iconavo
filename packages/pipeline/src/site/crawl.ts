// Обход сайта по HTTP (ADR-0050): со главной — по всем ссылкам на тот же адрес. Для каждой страницы —
// код ответа, заголовки, ссылки и якоря. Чистые части — разбор HTML, политики CSP и разделов README —
// проверяются тестами без браузера и без сети.

import { fail, pass, type Verdict } from "../sandbox/verdict.js";
import { STACKBLITZ_LINKS } from "../starters/links.js";
import { ROBOTS, UNTRANSLATED, VERSION_META } from "./config.js";

export interface CrawledPage {
  path: string;
  status: number;
  headers: Record<string, string>;
  html: string;
}

/** Адреса ссылок страницы: href у <a> и <link rel=…> не нужны — только переходы. */
export const anchorsOf = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) =>
    (m[1] as string).replaceAll("&amp;", "&"),
  );

/** id элементов страницы — цели якорей. */
export const idsOf = (html: string) =>
  new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] as string));

/** Обойти сайт со страницы / : только адреса того же сайта, без якорей и параметров. */
export async function crawl(
  base: string,
  extra: string[] = [],
): Promise<CrawledPage[]> {
  const seen = new Set<string>(["/", ...extra]);
  const queue = ["/", ...extra];
  const pages: CrawledPage[] = [];
  while (queue.length > 0) {
    const path = queue.shift() as string;
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const html = await response.text();
    pages.push({ path, status: response.status, headers, html });
    if (response.status !== 200) continue;
    for (const href of anchorsOf(html)) {
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const next = href.split("#")[0]?.split("?")[0] || "/";
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return pages;
}

/**
 * Ссылки: каждая внутренняя ведёт на страницу, которая ответила 200, а якорь — на id этой страницы;
 * внешние — только https; ссылки на StackBlitz — ровно из starters/links.ts.
 */
export function linksVerdict(pages: CrawledPage[]): Verdict {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const problems: string[] = [];
  let internal = 0;
  let external = 0;
  const live = new Set(Object.values(STACKBLITZ_LINKS));
  for (const page of pages.filter((p) => p.status === 200)) {
    for (const href of anchorsOf(page.html)) {
      if (href.startsWith("#")) {
        internal++;
        if (!idsOf(page.html).has(href.slice(1))) {
          problems.push(`${page.path}: якоря ${href} нет на странице`);
        }
        continue;
      }
      if (href.startsWith("/") && !href.startsWith("//")) {
        internal++;
        const [path, anchor] = href.split("#") as [string, string | undefined];
        const target = byPath.get(path.split("?")[0] || "/");
        if (target?.status !== 200) {
          problems.push(
            `${page.path}: ${href} — ${target?.status ?? "не открыта"}`,
          );
        } else if (anchor && !idsOf(target.html).has(anchor)) {
          problems.push(`${page.path}: якоря #${anchor} нет на ${path}`);
        }
        continue;
      }
      external++;
      if (!href.startsWith("https://")) {
        problems.push(`${page.path}: внешняя ссылка не по https — ${href}`);
      } else if (
        href.startsWith("https://stackblitz.com/") &&
        !live.has(href)
      ) {
        problems.push(
          `${page.path}: ссылка StackBlitz не из starters/links.ts — ${href}`,
        );
      }
    }
  }
  return problems.length === 0
    ? pass(
        `${internal} внутренних ссылок и якорей, ${external} внешних — все на месте`,
      )
    : fail([...new Set(problems)].slice(0, 6).join("; "));
}

/** Страницы с HTML: ответ 200, не robots.txt. */
export const htmlPages = (pages: CrawledPage[]) =>
  pages.filter((p) => p.status === 200 && p.path !== "/robots.txt");

/**
 * Коды ответов: страницы — 200, перечисленные несуществующие — 404, перечисленные переходы — этот
 * код на нужный адрес. Чего-то из перечисленного нет в обходе — тоже проблема.
 */
export function statusVerdict(
  pages: CrawledPage[],
  o: { missing: string[]; redirects: Record<string, string>; redirect: number },
): Verdict {
  const problems: string[] = [];
  for (const p of pages) {
    const to = o.redirects[p.path];
    if (o.missing.includes(p.path)) {
      if (p.status !== 404)
        problems.push(`${p.path} — ${p.status}, а ждали 404`);
    } else if (to !== undefined) {
      const location = p.headers.location
        ? new URL(p.headers.location, "http://site").pathname
        : "";
      if (p.status !== o.redirect || location !== to) {
        problems.push(
          `${p.path} — ${p.status} → ${location || "без адреса"}, а ждали ${o.redirect} → ${to}`,
        );
      }
    } else if (p.status !== 200) {
      problems.push(`${p.path} — ${p.status}`);
    }
  }
  for (const path of [...o.missing, ...Object.keys(o.redirects)]) {
    if (!pages.some((p) => p.path === path)) problems.push(`${path} не открыт`);
  }
  const ok = pages.filter((p) => p.status === 200).length;
  return problems.length === 0
    ? pass(
        `${ok} страниц — 200, несуществующие (${o.missing.length}) — 404, переходы (${Object.keys(o.redirects).length}) — ${o.redirect}`,
      )
    : fail(problems.slice(0, 5).join("; "));
}

/** Язык страницы по адресу: /ru и всё под ним — русский (apps/site/lib/i18n.ts). */
export const langOfPath = (path: string) =>
  path === "/ru" || path.startsWith("/ru/") ? "ru" : "en";

/** Атрибут lang у <html>. */
export const htmlLang = (html: string) =>
  /<html\b[^>]*\blang="([^"]*)"/i.exec(html)?.[1] ?? "";

/** Каждая страница с HTML объявляет язык своего адреса в <html lang>. */
export function langVerdict(pages: CrawledPage[]): Verdict {
  const problems = htmlPages(pages)
    .filter((p) => htmlLang(p.html) !== langOfPath(p.path))
    .map(
      (p) =>
        `${p.path}: lang="${htmlLang(p.html)}", а ждали «${langOfPath(p.path)}»`,
    );
  return problems.length === 0
    ? pass(`у всех ${htmlPages(pages).length} страниц`)
    : fail(problems.slice(0, 5).join("; "));
}

/** Ссылки с hreflang: адрес и язык цели. */
export const langLinksOf = (html: string) =>
  [...html.matchAll(/<a\b[^>]*>/gi)].flatMap((m) => {
    const tag = m[0];
    const hreflang = /\bhreflang="([^"]*)"/i.exec(tag)?.[1];
    const target = /\bhref="([^"]*)"/i.exec(tag)?.[1];
    return hreflang && target ? [{ href: target, hreflang }] : [];
  });

/** Та же страница на другом языке; у страниц без перевода — главная другого языка. */
export function counterpartOf(path: string): { lang: string; path: string } {
  if (langOfPath(path) === "ru") {
    return { lang: "en", path: path.slice("/ru".length) || "/" };
  }
  const untranslated = UNTRANSLATED.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
  return {
    lang: "ru",
    path: untranslated ? "/ru" : path === "/" ? "/ru" : `/ru${path}`,
  };
}

/** На каждой странице — ссылка на её пару на другом языке, и пара отвечает 200. */
export function switchVerdict(pages: CrawledPage[]): Verdict {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const problems: string[] = [];
  for (const page of htmlPages(pages)) {
    const pair = counterpartOf(page.path);
    const link = langLinksOf(page.html).find(
      (l) => l.href === pair.path && l.hreflang === pair.lang,
    );
    if (!link) {
      problems.push(
        `${page.path}: нет ссылки на ${pair.path} (hreflang="${pair.lang}")`,
      );
    } else if (byPath.get(pair.path)?.status !== 200) {
      problems.push(
        `${page.path}: ${pair.path} — ${byPath.get(pair.path)?.status ?? "не открыта"}`,
      );
    }
  }
  return problems.length === 0
    ? pass(`у всех ${htmlPages(pages).length} страниц — пара на другом языке`)
    : fail(problems.slice(0, 5).join("; "));
}

/** Адрес формы поиска в шапке: <search><form action>. */
export const searchActionOf = (html: string) =>
  /<search\b[^>]*>\s*<form\b[^>]*\baction="([^"]*)"/i.exec(html)?.[1];

/** Поле поиска в шапке каждой страницы ведёт на страницу поиска своего языка, и та отвечает 200. */
export function searchFormVerdict(pages: CrawledPage[]): Verdict {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const problems: string[] = [];
  for (const page of htmlPages(pages)) {
    const expected = langOfPath(page.path) === "ru" ? "/ru/search" : "/search";
    const action = searchActionOf(page.html);
    if (action !== expected) {
      problems.push(
        `${page.path}: форма поиска — ${action ?? "нет"}, а ждали ${expected}`,
      );
    } else if (byPath.get(expected)?.status !== 200) {
      problems.push(
        `${page.path}: ${expected} — ${byPath.get(expected)?.status ?? "не открыта"}`,
      );
    }
  }
  return problems.length === 0
    ? pass(`у всех ${htmlPages(pages).length} страниц — поиск своего языка`)
    : fail(problems.slice(0, 5).join("; "));
}

/** Директивы политики CSP: имя → источники. */
export function parseCsp(value: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

/**
 * Заголовки страницы: noindex, метка сборки, защита; в продакшене — CSP: стили только файлами,
 * соединения — только с хостами иконок, без встраивания в чужие страницы.
 */
export function headersVerdict(
  page: CrawledPage,
  o: { production: boolean; hosts: string[]; build?: string },
): string[] {
  const h = page.headers;
  const problems: string[] = [];
  if (h["x-robots-tag"] !== ROBOTS) {
    problems.push(`X-Robots-Tag: ${h["x-robots-tag"] ?? "нет"}`);
  }
  if (h["x-content-type-options"] !== "nosniff") problems.push("нет nosniff");
  if (h["referrer-policy"] !== "strict-origin-when-cross-origin") {
    problems.push(`Referrer-Policy: ${h["referrer-policy"] ?? "нет"}`);
  }
  if (h["x-frame-options"] !== "DENY")
    problems.push("нет X-Frame-Options: DENY");
  if (!h["x-iconavo-build"]) problems.push("нет X-Iconavo-Build");
  else if (o.build && h["x-iconavo-build"] !== o.build) {
    problems.push(`сборка ${h["x-iconavo-build"]}, а ждали ${o.build}`);
  }
  if (h["x-powered-by"]) problems.push(`X-Powered-By: ${h["x-powered-by"]}`);
  if (!o.production) return problems;
  const csp = h["content-security-policy"];
  if (!csp) return [...problems, "нет Content-Security-Policy"];
  const d = parseCsp(csp);
  const style = d.get("style-src") ?? [];
  if (style.join(" ") !== "'self'")
    problems.push(`style-src: ${style.join(" ")}`);
  const connect = (d.get("connect-src") ?? []).filter((s) => s !== "'self'");
  const expected = [...o.hosts].sort();
  if ([...connect].sort().join(" ") !== expected.join(" ")) {
    problems.push(
      `connect-src: ${connect.join(" ")}, а нужно ${expected.join(" ")}`,
    );
  }
  if ((d.get("frame-ancestors") ?? []).join(" ") !== "'none'") {
    problems.push("frame-ancestors не 'none'");
  }
  if ((d.get("object-src") ?? []).join(" ") !== "'none'") {
    problems.push("object-src не 'none'");
  }
  return problems;
}

/** Метка robots в HTML: ровно одна, noindex, nofollow. */
export function robotsMetaVerdict(html: string): Verdict {
  const metas = [...html.matchAll(/<meta\b[^>]*name="robots"[^>]*>/g)].map(
    (m) => m[0],
  );
  const content = metas.map((m) => /content="([^"]*)"/.exec(m)?.[1] ?? "");
  return metas.length === 1 && content[0] === ROBOTS
    ? pass(`<meta name="robots" content="${ROBOTS}">`)
    : fail(
        metas.length === 0
          ? "метки robots нет"
          : `меток robots: ${metas.length} (${content.join("; ")})`,
      );
}

/** Версия данных набора на его странице — метка <meta name="iconavo-version">; нет метки — undefined. */
export function versionMetaOf(html: string): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/g)) {
    if (m[0].includes(`name="${VERSION_META}"`)) {
      return /\bcontent="([^"]*)"/.exec(m[0])?.[1];
    }
  }
  return undefined;
}

/**
 * Свежесть данных (фаза 4, шаг 2): страница каждого набора из манифеста раздачи, на обоих языках,
 * показывает его версию. Иначе сайт собран со старыми данными — пересборка после «Выкладки» (site.yml)
 * это исправит.
 */
export function freshnessVerdict(
  pages: CrawledPage[],
  sets: Record<string, { version: string }>,
): Verdict {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const problems: string[] = [];
  for (const [id, { version }] of Object.entries(sets)) {
    for (const path of [`/${id}`, `/ru/${id}`]) {
      const page = byPath.get(path);
      const seen =
        page === undefined
          ? "страницы нет"
          : page.status !== 200
            ? `ответ ${page.status}`
            : (versionMetaOf(page.html) ?? "без метки версии");
      if (seen !== version) {
        problems.push(`${path}: ${seen}, а в манифесте ${version}`);
      }
    }
  }
  const total = Object.keys(sets).length;
  return problems.length === 0
    ? pass(`страницы ${total} наборов — версии из манифеста раздачи`)
    : fail(
        `${problems.slice(0, 4).join("; ")} — сайт собран со старыми данными: пересборка после «Выкладки» это исправит`,
      );
}

/** Разделы «##» README (и заголовок «#»), как их пишет сайт: без `кода` и **жирного**. */
export function readmeSections(markdown: string): string[] {
  const titles: string[] = [];
  let fence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("```")) fence = !fence;
    if (fence) continue;
    const m = /^## (.+)$/.exec(line);
    if (m) titles.push((m[1] as string).replace(/[`*]/g, "").trim());
  }
  return titles;
}

/** Текст заголовков h1 и h2 страницы — без тегов, с раскрытыми сущностями. */
export function headingsOf(html: string): string[] {
  return [...html.matchAll(/<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) =>
    (m[2] as string)
      .replace(/<[^>]+>/g, "")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#x27;", "'")
      .trim(),
  );
}

/**
 * Разделы README на сайте: каждый раздел «##» — заголовок h2 или h1 ровно одной страницы
 * документации; раздел, который стал заголовком страницы, — её h1.
 */
export function sectionsVerdict(
  pages: CrawledPage[],
  sections: string[],
): Verdict {
  const docs = pages.filter(
    (p) => p.status === 200 && p.path.startsWith("/docs"),
  );
  const problems: string[] = [];
  for (const title of sections) {
    const found = docs.filter((p) => headingsOf(p.html).includes(title));
    if (found.length !== 1) {
      problems.push(
        found.length === 0
          ? `раздела «${title}» нет на сайте`
          : `раздел «${title}» — на ${found.length} страницах`,
      );
    }
  }
  return problems.length === 0
    ? pass(
        `все ${sections.length} разделов README — на ${docs.length} страницах`,
      )
    : fail(problems.slice(0, 5).join("; "));
}
