// Разбор Markdown для страниц документации (ADR-0050): строгое подмножество, которым написаны README
// пакета и edge API. Блоки — заголовки # … ####, абзацы, код в ``` с языком из белого списка, списки «-»
// с вложением по два пробела (в пункте — абзацы, код и списки), таблицы GFM, цитата в один абзац.
// Внутри строки — текст, `код`, **жирный**, [ссылка](адрес) и экранирование «\». Всё остальное —
// ошибка с номером строки: так сайт и GitHub не разойдутся молча. Результат — дерево; страницу из
// него собирает React, без вставки HTML строкой.

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; depth: 1 | 2 | 3 | 4; children: Inline[]; line: number }
  | { type: "paragraph"; children: Inline[] }
  | { type: "code"; lang: string; value: string }
  | { type: "list"; items: Block[][] }
  | { type: "table"; head: Inline[][]; rows: Inline[][][] }
  | { type: "blockquote"; children: Block[] };

/** Языки блоков кода; пустая строка — без языка. */
export const LANGUAGES = new Set([
  "",
  "html",
  "js",
  "jsx",
  "ts",
  "tsx",
  "sh",
  "json",
  "css",
]);

interface Line {
  text: string;
  /** Номер строки в файле, с 1. */
  n: number;
}

const FENCE = /^```([a-z]*)\s*$/;
const HEADING = /^(#{1,4}) (.+)$/;
const ITEM = /^- (.*)$/;
const TABLE_RULE = /^\|( *:?-+:? *\|)+ *$/;

export class MarkdownError extends Error {}

const stop = (line: number, message: string): never => {
  throw new MarkdownError(`строка ${line}: ${message}`);
};

/** Ячейки строки таблицы: | a | b | → [a, b]; «\|» — сама черта. */
function cells(text: string): string[] {
  const body = text.trim().replace(/^\|/, "").replace(/\|$/, "");
  const result: string[] = [];
  let cell = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && body[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "|") {
      result.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  result.push(cell.trim());
  return result;
}

/** Строка начинает другой блок — абзац на ней кончается. */
const startsBlock = (text: string) =>
  FENCE.test(text) ||
  HEADING.test(text) ||
  ITEM.test(text) ||
  text.startsWith(">") ||
  text.startsWith("|");

function parseBlocks(lines: Line[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const { text, n } = lines[i] as Line;
    if (text.trim() === "") {
      i++;
      continue;
    }
    const fence = FENCE.exec(text);
    if (fence) {
      const lang = fence[1] ?? "";
      if (!LANGUAGES.has(lang))
        stop(n, `язык блока кода «${lang}» не из списка`);
      const body: string[] = [];
      i++;
      while (i < lines.length && (lines[i] as Line).text !== "```") {
        body.push((lines[i] as Line).text);
        i++;
      }
      if (i >= lines.length) stop(n, "блок кода не закрыт");
      i++;
      blocks.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }
    if (text.startsWith("```"))
      stop(n, "блок кода — только ``` и язык из списка");
    const heading = HEADING.exec(text);
    if (heading) {
      blocks.push({
        type: "heading",
        depth: (heading[1] as string).length as 1 | 2 | 3 | 4,
        children: parseInline(heading[2] as string, n),
        line: n,
      });
      i++;
      continue;
    }
    if (/^#{5,}/.test(text)) stop(n, "заголовки — только # … ####");
    if (/^ {4}/.test(text) && !ITEM.test(text.trimStart())) {
      stop(n, "код отступом не поддерживается — нужен блок ```");
    }
    if (/^\s+/.test(text)) stop(n, "лишний отступ вне списка");
    if (/^\d+[.)] /.test(text))
      stop(n, "нумерованные списки не поддерживаются");
    if (/^[*+] /.test(text)) stop(n, "список — только «- »");
    if (/^<[a-zA-Z/!]/.test(text)) stop(n, "HTML в Markdown не поддерживается");
    if (text.startsWith(">")) {
      const quoted: Line[] = [];
      while (i < lines.length && (lines[i] as Line).text.startsWith(">")) {
        const line = lines[i] as Line;
        quoted.push({ text: line.text.replace(/^> ?/, ""), n: line.n });
        i++;
      }
      const children = parseBlocks(quoted);
      if (children.length !== 1 || children[0]?.type !== "paragraph") {
        stop(n, "цитата — только один абзац");
      }
      blocks.push({ type: "blockquote", children });
      continue;
    }
    if (text.startsWith("|")) {
      const rule = lines[i + 1];
      if (!rule || !TABLE_RULE.test(rule.text))
        stop(n, "таблица без строки |---|");
      const head = cells(text).map((c) => parseInline(c, n));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines[i] as Line).text.startsWith("|")) {
        const line = lines[i] as Line;
        const row = cells(line.text);
        if (row.length !== head.length) {
          stop(
            line.n,
            `в строке таблицы ${row.length} ячеек, а в заголовке ${head.length}`,
          );
        }
        rows.push(row.map((c) => parseInline(c, line.n)));
        i++;
      }
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (ITEM.test(text)) {
      const items: Block[][] = [];
      while (i < lines.length && ITEM.test((lines[i] as Line).text)) {
        const first = lines[i] as Line;
        const body: Line[] = [
          {
            text: (ITEM.exec(first.text) as RegExpExecArray)[1] as string,
            n: first.n,
          },
        ];
        i++;
        // Пункт продолжается пустыми строками и строками с отступом от двух пробелов.
        while (i < lines.length) {
          const line = lines[i] as Line;
          if (line.text.startsWith("  ")) {
            body.push({ text: line.text.slice(2), n: line.n });
            i++;
          } else if (line.text.trim() === "") {
            const next = lines.slice(i).find((l) => l.text.trim() !== "");
            if (!next?.text.startsWith("  ")) break;
            body.push({ text: "", n: line.n });
            i++;
          } else break;
        }
        items.push(parseBlocks(body));
        // Пустая строка между пунктами не прерывает список.
        while (
          i < lines.length &&
          (lines[i] as Line).text.trim() === "" &&
          ITEM.test(
            lines.slice(i).find((l) => l.text.trim() !== "")?.text ?? "",
          )
        ) {
          i++;
        }
      }
      blocks.push({ type: "list", items });
      continue;
    }
    const paragraph: Line[] = [];
    while (
      i < lines.length &&
      (lines[i] as Line).text.trim() !== "" &&
      (paragraph.length === 0 || !startsBlock((lines[i] as Line).text))
    ) {
      const line = lines[i] as Line;
      if (/^(=+|-{3,})\s*$/.test(line.text)) {
        stop(line.n, "заголовок подчёркиванием или черта не поддерживаются");
      }
      if (/^ /.test(line.text)) stop(line.n, "лишний отступ в абзаце");
      paragraph.push(line);
      i++;
    }
    // Перевод строки внутри абзаца — пробел, как у GitHub.
    blocks.push({
      type: "paragraph",
      children: merge(
        paragraph.flatMap((line, k) => [
          ...(k > 0 ? [{ type: "text" as const, value: " " }] : []),
          ...parseInline(line.text, line.n),
        ]),
      ),
    });
  }
  return blocks;
}

/** Соседние куски текста — одним. */
function merge(list: Inline[]): Inline[] {
  const result: Inline[] = [];
  for (const node of list) {
    const last = result.at(-1);
    if (node.type === "text" && last?.type === "text") last.value += node.value;
    else result.push(node);
  }
  return result;
}

/** Строка с текстом, кодом, жирным и ссылками. */
export function parseInline(text: string, n: number): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  const literal = (value: string) => out.push({ type: "text", value });
  while (i < text.length) {
    const c = text[i] as string;
    if (c === "`") {
      const run = /^`+/.exec(text.slice(i))?.[0] as string;
      const end = text.indexOf(run, i + run.length);
      if (end === -1) stop(n, "код в строке не закрыт: `");
      let value = text.slice(i + run.length, end);
      if (value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "") {
        value = value.slice(1, -1);
      }
      out.push({ type: "code", value });
      i = end + run.length;
      continue;
    }
    if (c === "\\") {
      const next = text[i + 1];
      if (next === undefined || !/[!-/:-@[-`{-~]/.test(next)) {
        stop(n, "«\\» — только перед знаком препинания");
      }
      literal(next as string);
      i += 2;
      continue;
    }
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end === -1) stop(n, "жирный не закрыт: **");
      out.push({
        type: "strong",
        children: parseInline(text.slice(i + 2, end), n),
      });
      i = end + 2;
      continue;
    }
    if (c === "[") {
      const close = text.indexOf("](", i);
      const end = close === -1 ? -1 : text.indexOf(")", close);
      if (close === -1 || end === -1)
        stop(n, "ссылка без адреса: [текст](адрес)");
      const href = text.slice(close + 2, end);
      if (/\s/.test(href) || href === "")
        stop(n, `адрес ссылки с пробелом или пустой: ${href}`);
      out.push({
        type: "link",
        href,
        children: parseInline(text.slice(i + 1, close), n),
      });
      i = end + 1;
      continue;
    }
    if (c === "*" || c === "~")
      stop(n, `разметка «${c}» не поддерживается — только **жирный**`);
    if (c === "!" && text[i + 1] === "[") stop(n, "картинки не поддерживаются");
    if (c === "<" && /[a-zA-Z/!]/.test(text[i + 1] ?? "")) {
      stop(n, "HTML в тексте не поддерживается — оберните в `код`");
    }
    if (c === "&" && /^&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(text.slice(i))) {
      stop(n, "сущности HTML не поддерживаются — пишите символ");
    }
    if (
      /^https?:\/\//.test(text.slice(i)) &&
      !/[\w/]/.test(text[i - 1] ?? "")
    ) {
      stop(
        n,
        "адрес без ссылки: GitHub сделает его ссылкой, а сайт — нет; оформите [текст](адрес) или `код`",
      );
    }
    literal(c);
    i++;
  }
  return merge(out);
}

/** Разбор документа целиком. */
export function parseMarkdown(source: string): Block[] {
  const lines = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((text, k) => ({ text, n: k + 1 }));
  return parseBlocks(lines);
}

/** Текст строки без разметки — для якоря и оглавления. */
export const plainText = (list: Inline[]): string =>
  list
    .map((node) =>
      node.type === "text" || node.type === "code"
        ? node.value
        : plainText(node.children),
    )
    .join("");
