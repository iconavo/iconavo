// Конфиг SVGO (ADR-0015): свой явный список плагинов, как у Iconify, а не preset-default — тот
// меняется от версии к версии. Версия SVGO закреплена точно; любое изменение версии или этого списка —
// полная пересборка data/ (с шага 6 — и попиксельное сравнение).
//
// Намеренно не включены:
// - cleanupIds — сжал бы наши ID `{набор}--{иконка}-{n}` (ADR-0014);
// - reusePaths — создаёт новые ID и <use>;
// - removeViewBox — viewBox не удаляется (ADR-0015);
// - плагины стилей и комментариев — санитайзер уже перевёл стили в атрибуты и всё лишнее удалил;
// - moveElemsAttrsToGroup — на наших данных почти ничего не даёт, а с filter и transform вместе
//   ломает рисунок (svgo#1752; Iconify для таких иконок его отключает).

import type { Config } from "svgo";

/** Знаков после запятой в координатах и размерах. */
export const PRECISION = 3;

/** Сетки, для которых подобрана точность: трёх знаков хватает для 24 и 32 (ADR-0015). */
export const SUPPORTED_GRIDS: ReadonlySet<number> = new Set([24, 32]);

export const SVGO_CONFIG: Config = {
  multipass: true,
  floatPrecision: PRECISION,
  // eol — явно: на Windows SVGO по умолчанию пишет CRLF.
  js2svg: { pretty: false, useShortTags: true, finalNewline: false, eol: "lf" },
  plugins: [
    "cleanupAttrs",
    "removeUselessDefs",
    "removeEmptyAttrs",
    "removeEmptyContainers",
    "convertColors",
    "convertTransform",
    "removeUnknownsAndDefaults",
    "removeNonInheritableGroupAttrs",
    "cleanupNumericValues",
    "cleanupListOfValues",
    // Переносит transform внешнего <g> на <path>, а convertPathData впечатывает его в координаты.
    "moveGroupAttrsToElems",
    "collapseGroups",
    // removeNone: фигура без заливки и обводки ничего не рисует — так уходит рамка Tabler.
    { name: "removeUselessStrokeAndFill", params: { removeNone: true } },
    "removeHiddenElems",
    // Круги и эллипсы остаются фигурами, как у Iconify (convertArcs выключен).
    "convertShapeToPath",
    "convertEllipseToCircle",
    { name: "convertPathData", params: { noSpaceAfterFlags: true } },
    { name: "mergePaths", params: { noSpaceAfterFlags: true } },
    "sortDefsChildren",
    // Последним: плагины выше добавляют атрибуты, а порядок должен быть всегда один.
    "sortAttrs",
  ],
};
