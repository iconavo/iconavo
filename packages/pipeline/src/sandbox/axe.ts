// Доступность в проверках браузеров (ADR-0035): axe-core на открытой странице — только правила WCAG
// уровней A и AA — и вердикт строки отчёта. Общее для примера на Next.js, примеров StackBlitz и сайта.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Page } from "playwright";
import { fail, pass, type Verdict } from "./verdict.js";

/** Нарушение axe: правило, важность и первые элементы. */
export interface AxeViolation {
  id: string;
  impact: string;
  nodes: string[];
}

/** Правила axe — только WCAG уровней A и AA, как требует ADR-0038 для сайта: без рекомендаций axe. */
export const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];

/** Доступность: ни одного нарушения ни на одной странице. */
export function axeVerdict(
  pages: { path: string; violations: AxeViolation[] }[],
): Verdict {
  const problems = pages.flatMap((p) =>
    p.violations.map(
      (v) => `${p.path}: ${v.id} (${v.impact}) — ${v.nodes.join(", ")}`,
    ),
  );
  return problems.length === 0
    ? pass(
        `нарушений нет: ${pages.map((p) => p.path).join(" и ")}, правила WCAG 2.2 A и AA`,
      )
    : fail(problems.slice(0, 5).join("; "));
}

/** Текст axe-core — его вставляет на страницу проверка. */
let axeSource: Promise<string> | undefined;
export const axe = () => {
  axeSource ??= readFile(
    createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
    "utf8",
  );
  return axeSource;
};

/**
 * axe-core на открытой странице: правила WCAG A и AA, только нарушения. exclude — селекторы элементов,
 * которые axe не оценит: например, кнопка с подписью тега через ElementInternals — её axe не видит.
 */
export async function runAxe(
  page: Page,
  source: string,
  path: string,
  pages: { path: string; violations: AxeViolation[] }[],
  exclude: string[] = [],
): Promise<void> {
  // После перехода по ссылке внутри Next.js документ тот же — axe в нём уже есть.
  if (!(await page.evaluate(() => "axe" in window))) {
    await page.addScriptTag({ content: source });
  }
  pages.push({
    path,
    violations: await page.evaluate(
      async ([tags, skip]) => {
        const { axe } = window as unknown as {
          axe: {
            run(
              context: Document | { exclude: string[] },
              options: unknown,
            ): Promise<{
              violations: {
                id: string;
                impact?: string | null;
                nodes: { target: unknown[] }[];
              }[];
            }>;
          };
        };
        const found = await axe.run(
          skip.length > 0 ? { exclude: skip } : document,
          {
            runOnly: { type: "tag", values: tags },
            resultTypes: ["violations"],
          },
        );
        return found.violations.map((v) => ({
          id: v.id,
          impact: v.impact ?? "",
          nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
        }));
      },
      [AXE_TAGS, exclude] as const,
    ),
  });
}
