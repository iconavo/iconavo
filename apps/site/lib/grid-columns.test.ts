import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Колонки сетки набора и выдачи поиска — от ширины окна (app/globals.css, решение владельца 13 ноября
// 2026): n колонок — с окна n·(карточка + зазор) − зазор + (боковая панель + поля страницы). Тест сверяет
// пороги в стилях с этой формулой и с размерами раскладки из тех же стилей: поменяли ширину панели, поля
// или зазор — пороги надо пересчитать.

const css = readFileSync(
  join(import.meta.dirname, "..", "app", "globals.css"),
  "utf8",
);

/** Значение в rem у свойства из стилей: первое вхождение после метки. */
function remAfter(marker: string, property: string): number {
  const from = css.indexOf(marker);
  expect(from, `нет «${marker}» в globals.css`).toBeGreaterThanOrEqual(0);
  const match = css
    .slice(from)
    .match(new RegExp(`${property}:\\s*([\\d.]+)rem`));
  expect(match, `нет ${property} после «${marker}»`).not.toBeNull();
  return Number(match?.[1]);
}

/** Пороги одного числа колонок: [окно в rem, колонок], по возрастанию. */
function steps(name: "icon" | "result"): [number, number][] {
  const found: [number, number][] = [];
  const block =
    /@media \(min-width: ([\d.]+)rem\) \{\s*:root \{\s*--(icon|result)-cols: (\d+);\s*\}\s*\}/g;
  for (const m of css.matchAll(block)) {
    if (m[2] === name) found.push([Number(m[1]), Number(m[3])]);
  }
  return found;
}

describe("колонки сеток — от ширины окна", () => {
  // Колонка страницы при развёрнутой боковой панели: окно − панель − поля страницы с двух сторон.
  const frame =
    remAfter("--width-sidebar:", "--width-sidebar") +
    2 *
      remAfter(
        "@media (min-width: 64rem) {\n  :root {\n    --page-x:",
        "--page-x",
      );
  const desktop =
    /@media \(min-width: 64rem\) \{\s*:root \{\s*--icon-cols: (\d+);\s*--result-cols: (\d+);/.exec(
      css,
    );

  const grids = [
    {
      name: "icon" as const,
      card: 8.75,
      gap: remAfter("  .icon-grid {", "gap"),
      first: Number(desktop?.[1]),
    },
    {
      name: "result" as const,
      card: 7.5,
      gap: remAfter("  .result-grid {", "gap"),
      first: Number(desktop?.[2]),
    },
  ];

  it("колонка страницы — окно − 19rem", () => {
    expect(frame).toBe(19);
    expect(desktop).not.toBeNull();
  });

  for (const { name, card, gap, first } of grids) {
    it(`--${name}-cols: с 64rem и на каждом пороге — сколько карточек встаёт`, () => {
      const fit = (width: number) =>
        Math.floor((width - frame + gap) / (card + gap));
      expect(first).toBe(fit(64));
      const found = steps(name);
      expect(found.length).toBeGreaterThan(10);
      let columns = first;
      for (const [width, n] of found) {
        expect(n, `порог ${width}rem`).toBe(columns + 1);
        // С этого окна встаёт n карточек, на 1/100 rem раньше — ещё n − 1.
        expect(fit(width)).toBe(n);
        expect(fit(width - 0.01)).toBe(n - 1);
        columns = n;
      }
      // Хватает до окна 4K (3840 px).
      expect(found[found.length - 1][0]).toBeGreaterThan(240);
    });
  }

  it("сетка набора — колонки из --icon-cols, до 64rem — 3; выдача с 64rem — из --result-cols", () => {
    expect(css).toMatch(/:root \{\s*--icon-cols: 3;\s*\}/);
    expect(css).toMatch(
      /\.icon-grid \{[^}]*grid-template-columns: repeat\(var\(--icon-cols\), minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /\.result-grid \{\s*grid-template-columns: repeat\(var\(--result-cols\), minmax\(0, 1fr\)\);/,
    );
    // Ни панель иконки, ни боковая панель колонки не переопределяют.
    expect(css).not.toMatch(
      /\.with-panel\[data-panel\][^{]*\.icon-grid[^{]*\{[^}]*grid-template-columns/,
    );
  });
});
