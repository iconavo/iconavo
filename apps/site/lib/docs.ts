// Страницы документации из README (ADR-0050, ADR-0036): README пакета, edge API и журнал изменений
// пакетов (ADR-0051) — единственный источник, сайт их только раскладывает по страницам. Каждый раздел
// «##» README пакета попадает ровно на одну страницу, якоря — как у GitHub, ссылки README переписываются
// на страницы сайта. Раздел без страницы, неизвестный якорь, ссылка не по https или относительная —
// остановка сборки с подсказкой.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Block,
  type Inline,
  MarkdownError,
  parseMarkdown,
  plainText,
} from "./markdown";
import { slugger } from "./slug";

export type Source = "icon" | "api" | "changelog";

/** Файлы источников от корня репозитория. */
export const SOURCES: Record<Source, string> = {
  icon: "packages/icon/README.md",
  api: "apps/api/README.md",
  changelog: "packages/icon/CHANGELOG.md",
};

const SOURCE_IDS = Object.keys(SOURCES) as Source[];

export interface PageDef {
  /** Адрес: /docs или /docs/{slug}. */
  slug: string;
  title: string;
  /** Короткое описание — для заголовка страницы в поиске и соцсетях. */
  description: string;
  source: Source;
  /** Разделы «##» источника по порядку; "" — вступление до первого «##»; "*" — весь файл. */
  sections: string[];
}

export const PAGES: readonly PageDef[] = [
  {
    slug: "",
    title: "Quick start",
    description:
      "Install the Iconavo tag or the React component and show your first icon.",
    source: "icon",
    sections: ["", "Install", "Examples", "Live examples"],
  },
  {
    slug: "reference",
    title: "Reference",
    description:
      "Attributes, React props and the functions configure, addIcons, setLoader and loadIcons.",
    source: "icon",
    sections: ["Attributes and props", "Functions", "Loading and errors"],
  },
  {
    slug: "recipes",
    title: "Recipes",
    description:
      "Your own host, icons without network requests, and server rendering with Next.js.",
    source: "icon",
    sections: ["Recipes"],
  },
  {
    slug: "iconify",
    title: "Coming from Iconify",
    description: "What changes when you move from Iconify to Iconavo.",
    source: "icon",
    sections: ["Coming from Iconify"],
  },
  {
    slug: "security",
    title: "Hosts, privacy and browsers",
    description:
      "Which hosts the package talks to, what it stores, Content Security Policy, browsers and licenses.",
    source: "icon",
    sections: [
      "Hosts, privacy and security",
      "Browsers and frameworks",
      "License",
    ],
  },
  {
    slug: "api",
    title: "Edge API",
    description: "Icon data, SVG, CSS and search addresses of api.iconavo.dev.",
    source: "api",
    sections: ["*"],
  },
  {
    slug: "changelog",
    title: "Changelog",
    description:
      "What changed in each version of @iconavo-ui/icon, @iconavo-ui/react and @iconavo-ui/core.",
    source: "changelog",
    sections: ["*"],
  },
];

export const pagePath = (slug: string) =>
  slug === "" ? "/docs" : `/docs/${slug}`;

/** Заголовок с якорем — для оглавления и проверки ссылок. */
export interface Heading {
  depth: number;
  id: string;
  text: string;
}

export interface DocPage extends PageDef {
  path: string;
  blocks: Block[];
  /** Якоря заголовков страницы (h2, h3, h4), по порядку. */
  headings: Heading[];
  /** Якоря разделов, которые стали заголовком страницы: ссылка на них — на страницу. */
  aliases: string[];
  /** Править на GitHub. */
  edit: string;
}

/** Блок с якорем — заголовок после раскладки. */
export type DocBlock = Block & { id?: string };

const REPO = "https://github.com/iconavo/iconavo";

class DocsError extends Error {}

const stop = (message: string): never => {
  throw new DocsError(`СТОП: ${message}`);
};

/** Разделы файла: вступление (до первого «##») и каждый «##» со всем, что под ним. */
function sections(blocks: Block[]): { title: string; blocks: Block[] }[] {
  const result: { title: string; blocks: Block[] }[] = [
    { title: "", blocks: [] },
  ];
  for (const block of blocks) {
    if (block.type === "heading" && block.depth === 2) {
      result.push({ title: plainText(block.children), blocks: [block] });
    } else (result.at(-1) as { blocks: Block[] }).blocks.push(block);
  }
  return result;
}

/** Якоря всех заголовков файла — по GitHub: по порядку, с повторами -1, -2. */
function anchors(blocks: Block[]): Map<Block, string> {
  const next = slugger();
  const ids = new Map<Block, string>();
  for (const block of blocks) {
    if (block.type === "heading")
      ids.set(block, next(plainText(block.children)));
  }
  return ids;
}

/**
 * Прочитать и разобрать источник. Страницы собираются при сборке, на сервере файлы не нужны — поэтому
 * трассировка Next.js путь не отслеживает: иначе в выкладку попал бы весь репозиторий.
 */
function load(root: string, source: Source): Block[] {
  const file = SOURCES[source];
  try {
    return parseMarkdown(
      readFileSync(join(/*turbopackIgnore: true*/ root, file), "utf8"),
    );
  } catch (e) {
    if (e instanceof MarkdownError) stop(`${file}, ${e.message}`);
    throw e;
  }
}

/** Страницы из источников, без переписанных ссылок. */
function layout(root: string): DocPage[] {
  const parsed = Object.fromEntries(
    SOURCE_IDS.map((s) => [s, load(root, s)]),
  ) as Record<Source, Block[]>;
  const ids = Object.fromEntries(
    SOURCE_IDS.map((s) => [s, anchors(parsed[s])]),
  ) as Record<Source, Map<Block, string>>;
  const split = Object.fromEntries(
    SOURCE_IDS.map((s) => [s, sections(parsed[s])]),
  ) as Record<Source, { title: string; blocks: Block[] }[]>;
  for (const source of SOURCE_IDS) {
    const used = PAGES.filter((p) => p.source === source).flatMap(
      (p) => p.sections,
    );
    if (used.includes("*")) continue;
    for (const section of split[source]) {
      const count = used.filter((s) => s === section.title).length;
      if (count === 0) {
        stop(
          `раздел README «${section.title || "вступление"}» (${SOURCES[source]}) не попал ни на одну страницу — допишите его в apps/site/lib/docs.ts`,
        );
      }
      if (count > 1)
        stop(`раздел README «${section.title}» — на нескольких страницах`);
    }
    for (const title of used) {
      if (!split[source].some((s) => s.title === title)) {
        stop(
          `в ${SOURCES[source]} нет раздела «${title}» из apps/site/lib/docs.ts`,
        );
      }
    }
  }
  return PAGES.map((def) => {
    const all = split[def.source];
    const chosen = def.sections.includes("*")
      ? all
      : def.sections.map(
          (title) =>
            all.find((s) => s.title === title) as {
              title: string;
              blocks: Block[];
            },
        );
    // Заголовок источника (#) не нужен: у страницы свой. Раздел, совпавший с названием страницы, тоже
    // становится заголовком страницы, а его подразделы поднимаются на уровень.
    const aliases: string[] = [];
    const blocks: DocBlock[] = [];
    const single = chosen.length === 1 && chosen[0]?.title === def.title;
    for (const section of chosen) {
      for (const block of section.blocks) {
        const id = ids[def.source].get(block);
        if (block.type === "heading" && block.depth === 1) {
          if (id) aliases.push(id);
          continue;
        }
        if (single && block.type === "heading" && block.depth === 2) {
          if (id) aliases.push(id);
          continue;
        }
        if (block.type === "heading") {
          const depth = (single ? block.depth - 1 : block.depth) as
            | 1
            | 2
            | 3
            | 4;
          blocks.push({ ...block, depth, id });
        } else blocks.push(block);
      }
    }
    const headings = blocks.flatMap((b) =>
      b.type === "heading" && b.id
        ? [{ depth: b.depth, id: b.id, text: plainText(b.children) }]
        : [],
    );
    return {
      ...def,
      path: pagePath(def.slug),
      blocks,
      headings,
      aliases,
      edit: `${REPO}/edit/main/${SOURCES[def.source]}`,
    };
  });
}

/** Куда ведёт ссылка README на сайте; null — оставить как есть (внешняя). */
function rewrite(href: string, page: DocPage, pages: DocPage[]): string | null {
  const where = (source: Source, anchor: string) => {
    if (anchor === "") {
      const first = pages.find((p) => p.source === source) as DocPage;
      return first.path;
    }
    const target = pages.find(
      (p) =>
        p.source === source &&
        (p.headings.some((h) => h.id === anchor) || p.aliases.includes(anchor)),
    );
    if (!target)
      stop(
        `ссылка на якорь #${anchor} (${SOURCES[source]}) — такого заголовка нет`,
      );
    const t = target as DocPage;
    if (t.aliases.includes(anchor)) return t.path;
    return t === page ? `#${anchor}` : `${t.path}#${anchor}`;
  };
  if (href.startsWith("#")) return where(page.source, href.slice(1));
  for (const source of SOURCE_IDS) {
    const blob = `${REPO}/blob/main/${SOURCES[source]}`;
    if (href === blob || href.startsWith(`${blob}#`)) {
      return where(source, href.slice(blob.length + 1));
    }
  }
  if (/^https:\/\/iconavo\.dev\/docs([/#]|$)/.test(href)) {
    return href.slice("https://iconavo.dev".length);
  }
  if (!href.startsWith("https://")) {
    stop(
      `ссылка «${href}» — только https:// или #якорь: относительные адреса на сайте не работают`,
    );
  }
  return null;
}

const relink = (list: Inline[], fix: (href: string) => string): Inline[] =>
  list.map((node) =>
    node.type === "link"
      ? { ...node, href: fix(node.href), children: relink(node.children, fix) }
      : node.type === "strong"
        ? { ...node, children: relink(node.children, fix) }
        : node,
  );

function relinkBlocks(
  blocks: DocBlock[],
  fix: (href: string) => string,
): DocBlock[] {
  return blocks.map((block): DocBlock => {
    switch (block.type) {
      case "heading":
      case "paragraph":
        return { ...block, children: relink(block.children, fix) };
      case "list":
        return {
          ...block,
          items: block.items.map((item) => relinkBlocks(item, fix)),
        };
      case "blockquote":
        return { ...block, children: relinkBlocks(block.children, fix) };
      case "table":
        return {
          ...block,
          head: block.head.map((cell) => relink(cell, fix)),
          rows: block.rows.map((row) => row.map((cell) => relink(cell, fix))),
        };
      default:
        return block;
    }
  });
}

const cache = new Map<string, DocPage[]>();

/**
 * Все страницы документации. root — корень репозитория: Next.js собирает сайт из папки apps/site,
 * тесты передают свой.
 */
export function docPages(root = join(process.cwd(), "..", "..")): DocPage[] {
  const cached = cache.get(root);
  if (cached) return cached;
  const pages = layout(root);
  const done = pages.map((page) => ({
    ...page,
    blocks: relinkBlocks(
      page.blocks,
      (href) => rewrite(href, page, pages) ?? href,
    ),
  }));
  cache.set(root, done);
  return done;
}

export const docPage = (slug: string) =>
  docPages().find((p) => p.slug === slug);
