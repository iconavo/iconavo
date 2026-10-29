// Обход сайта по HTTP (ADR-0050): со главной — по всем ссылкам на тот же адрес. Для каждой страницы —
// код ответа, заголовки, ссылки и якоря. Чистые части — разбор HTML, политики CSP и разделов README —
// проверяются тестами без браузера и без сети.

import { fail, pass, type Verdict } from "../sandbox/verdict.js";
import { STACKBLITZ_LINKS } from "../starters/links.js";
import { ROBOTS } from "./config.js";

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
