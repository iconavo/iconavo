import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Колонки сеток — от ширины окна (app/globals.css, решения владельца 13 ноября 2026): сетка набора (у
// выдачи поиска — она же, редизайн 17 ноября 2026) и карточки наборов на главной и в списке. n колонок — с окна n·(карточка + зазор) − зазор
// + (боковая панель + поля страницы). Тест сверяет пороги в стилях с этой формулой и с размерами
// раскладки из тех же стилей: поменяли ширину панели, поля или зазор — пороги надо пересчитать.

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

/** Наименьшая ширина карточки в rem: minmax(…rem, …) первого правила после метки. */
function minCardAfter(marker: string): number {
  const from = css.indexOf(marker);
  expect(from, `нет «${marker}» в globals.css`).toBeGreaterThanOrEqual(0);
  const match = /minmax\(([\d.]+)rem/.exec(css.slice(from));
  expect(match, `нет minmax после «${marker}»`).not.toBeNull();
  return Number(match?.[1]);
}

type Cols = "icon" | "set" | "sets";

/** Значения --{name}-cols по порогам ширины окна: [окно в rem, колонок], по возрастанию. */
function steps(name: Cols): [number, number][] {
  const found: [number, number][] = [];
  const block = /@media \(min-width: ([\d.]+)rem\) \{\s*:root \{([^}]*)\}/g;
  for (const m of css.matchAll(block)) {
    const value = new RegExp(`--${name}-cols: (\\d+);`).exec(m[2]);
    if (value) found.push([Number(m[1]), Number(value[1])]);
  }
  return found.sort((a, b) => a[0] - b[0]);
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

  const grids: { name: Cols; card: number; gap: number; max?: number }[] = [
    { name: "icon", card: 8.75, gap: remAfter("  .icon-grid {", "gap") },
    {
      name: "set",
      card: minCardAfter("  .set-grid {"),
      gap: remAfter("  .set-grid {", "gap"),
    },
    // Список наборов — в .container: на широких окнах не шире 96rem (контейнер Tailwind), не больше 5.
    {
      name: "sets",
      card: minCardAfter("  .set-grid {"),
      gap: remAfter("  .set-grid {", "gap"),
      max: 5,
    },
  ];

  it("колонка страницы — окно − 19rem, карточка набора — 15rem", () => {
    expect(frame).toBe(19);
    expect(grids[1].card).toBe(15);
  });

  for (const { name, card, gap, max } of grids) {
    it(`--${name}-cols: с 64rem и на каждом пороге — сколько карточек встаёт`, () => {
      const fit = (width: number) =>
        Math.min(
          max ?? Number.POSITIVE_INFINITY,
          Math.floor((width - frame + gap) / (card + gap)),
        );
      const found = steps(name);
      expect(found[0][0], "первое значение — с 64rem").toBe(64);
      expect(found[0][1]).toBe(fit(64));
      for (const [i, [width, n]] of found.entries()) {
        if (i === 0) continue;
        expect(n, `порог ${width}rem`).toBe(found[i - 1][1] + 1);
        // С этого окна встаёт n карточек, на 1/100 rem раньше — ещё n − 1.
        expect(fit(width)).toBe(n);
        expect(fit(width - 0.01)).toBe(n - 1);
      }
      if (max === undefined) {
        // Хватает до окна 4K (3840 px).
        expect(found[found.length - 1][0]).toBeGreaterThan(240 - card);
      } else {
        expect(found[found.length - 1][1]).toBe(max);
      }
    });
  }

  it("сетки берут колонки из своих переменных, ни одна панель их не переопределяет", () => {
    expect(css).toMatch(/:root \{\s*--icon-cols: 3;\s*\}/);
    expect(css).toMatch(
      /\.icon-grid \{[^}]*grid-template-columns: repeat\(var\(--icon-cols\), minmax\(0, 1fr\)\);/,
    );
    // Выдача поиска — та же сетка: класс icon-grid у списка выдачи, своей лестницы колонок нет.
    expect(css).not.toMatch(/--result-cols/);
    expect(css).toMatch(
      /\.set-grid \{\s*grid-template-columns: repeat\(var\(--set-cols\), minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /\.container \.set-grid \{\s*grid-template-columns: repeat\(var\(--sets-cols\), minmax\(0, 1fr\)\);/,
    );
    expect(css).not.toMatch(
      /\.with-panel\[data-panel\][^{]*\.icon-grid[^{]*\{[^}]*grid-template-columns/,
    );
  });
});
