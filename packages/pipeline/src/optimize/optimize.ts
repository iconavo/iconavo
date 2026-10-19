// Оптимизация иконки через SVGO (ADR-0015) и проверка результата. SVGO получает иконку уже после
// санитайзера и нормализации, поэтому DOCTYPE и сущности до него не доходят (ADR-0013). Результат
// снова проходит санитайзер и независимую проверку, а ID нумеруются заново, как на шаге 4.

import { optimize } from "svgo";
import { renameIds } from "../normalize/ids.js";
import { iconToSvg, type NormalizedIcon } from "../normalize/normalize.js";
import { checkSafeSvg } from "../sanitize/check.js";
import { sanitizeSvg } from "../sanitize/sanitize.js";
import { elements, idMap, refsOf } from "../svg/refs.js";
import { type SvgElement, serializeSvg } from "../svg/serialize.js";
import { PRECISION, SVGO_CONFIG } from "./config.js";

export type OptimizeResult =
  | {
      ok: true;
      icon: NormalizedIcon;
      /** Элементов с transform после SVGO: масштаб не впечатался или transform авторский. */
      transformsLeft: number;
    }
  | { ok: false; problem: string };

/** Анимации SMIL: санитайзер их пока исключает (ADR-0013), а этот конфиг SVGO может их сломать. */
const ANIMATION = /<(?:animate\w*|set)[\s/>]/;

/** Размер с точностью SVGO: viewBox он тоже округляет, а размер в JSON должен с ним совпадать. */
export const roundSize = (n: number) => Number(n.toFixed(PRECISION));

/** Сколько ссылок ведёт на ID, которых в иконке нет. */
function danglingRefs(root: SvgElement): number {
  const all = elements(root);
  const ids = idMap(all);
  let count = 0;
  for (const el of all) {
    for (const [name, value] of Object.entries(el.attrs)) {
      for (const id of refsOf(name, value)) if (!ids.has(id)) count++;
    }
  }
  return count;
}

/** Разбирает SVG, который уже должен быть чистым: санитайзер не вправе в нём ничего менять. */
function parseClean(svg: string, stage: string): SvgElement | string {
  const r = sanitizeSvg(svg);
  if (r.status === "excluded") {
    return `${stage}: санитайзер исключил иконку — ${r.reason}`;
  }
  if (r.changed || r.lost.length > 0) {
    const what = [...r.removals.map((x) => x.what), ...r.lost].join(", ");
    return `${stage}: санитайзер изменил иконку — ${what}`;
  }
  return r.svg;
}

/** Корень после SVGO — только viewBox="0 0 W H" с нашими шириной и высотой. */
function rootProblem(
  root: SvgElement,
  width: number,
  height: number,
): string | undefined {
  const names = Object.keys(root.attrs);
  const box = (root.attrs.viewBox ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const ok =
    names.length === 1 &&
    box.length === 4 &&
    box[0] === 0 &&
    box[1] === 0 &&
    box[2] === width &&
    box[3] === height;
  if (ok) return undefined;
  const attrs = Object.entries(root.attrs)
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
  return `после SVGO у корня ${attrs || "нет атрибутов"}, а ожидался viewBox="0 0 ${width} ${height}"`;
}

/**
 * Оптимизирует одну иконку; base — `{набор}--{иконка}`, основа ID (ADR-0014). Любая проблема — повод
 * остановить набор: исходное тело вместо оптимизированного не подставляется.
 */
export function optimizeIcon(
  input: NormalizedIcon,
  base: string,
): OptimizeResult {
  if (ANIMATION.test(input.body)) {
    return {
      ok: false,
      problem:
        "анимация: сначала настройте плагины SVGO для анимаций (ADR-0013, ADR-0015)",
    };
  }
  const width = roundSize(input.width);
  const height = roundSize(input.height);
  const svg = iconToSvg({ body: input.body, width, height });
  const before = parseClean(svg, "до SVGO");
  if (typeof before === "string") return { ok: false, problem: before };

  let output: string;
  try {
    output = optimize(svg, SVGO_CONFIG).data;
  } catch (e) {
    return { ok: false, problem: `SVGO: ${(e as Error).message}` };
  }
  const root = parseClean(output, "после SVGO");
  if (typeof root === "string") return { ok: false, problem: root };
  const wrongRoot = rootProblem(root, width, height);
  if (wrongRoot !== undefined) return { ok: false, problem: wrongRoot };

  renameIds(root, base);
  if (danglingRefs(root) > danglingRefs(before)) {
    return {
      ok: false,
      problem: "после SVGO появились ссылки на несуществующие ID",
    };
  }
  const icon: NormalizedIcon = {
    body: root.children.map((child) => serializeSvg(child)).join(""),
    width,
    height,
  };
  const problems = checkSafeSvg(iconToSvg(icon));
  if (problems.length > 0) {
    return {
      ok: false,
      problem: `независимая проверка: ${problems.join("; ")}`,
    };
  }
  const transformsLeft = elements(root).filter(
    (el) => el.attrs.transform !== undefined,
  ).length;
  return { ok: true, icon, transformsLeft };
}
