import { SVG_NS } from "./xml.js";

/**
 * Очищенный элемент SVG — то, что конвейер передаёт дальше (нормализация, оптимизация):
 * только имя, атрибуты и дочерние элементы, без текста, комментариев и приставок.
 */
export interface SvgElement {
  tag: string;
  /** Атрибуты в порядке вывода; имена — только из белого списка санитайзера. */
  attrs: Record<string, string>;
  children: SvgElement[];
}

const escapeAttr = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Пишет элемент в строку. `xmlns` нужен корню, когда файл должен открываться сам по себе. */
export function serializeSvg(
  el: SvgElement,
  options: { xmlns?: boolean } = {},
): string {
  let out = `<${el.tag}`;
  if (options.xmlns) out += ` xmlns="${SVG_NS}"`;
  for (const [name, value] of Object.entries(el.attrs)) {
    out += ` ${name}="${escapeAttr(value)}"`;
  }
  if (el.children.length === 0) return `${out}/>`;
  const inner = el.children.map((child) => serializeSvg(child)).join("");
  return `${out}>${inner}</${el.tag}>`;
}
