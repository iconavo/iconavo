import type { SourceConfigInput } from "@iconavo-ui/pipeline";

// Вес 400, три формы (ADR-0008). Имена как у Iconify: без суффикса — заливка (в источнике это
// home-fill.svg), -outline — контур (в источнике home.svg), затем -rounded или -sharp.
// Метка «~» временная: она отличает файлы с -fill от остальных на время замен.
const base = [
  { pattern: "_", with: "-" },
  { pattern: "^(.+)-fill$", with: "$1~" },
  { pattern: "^([^~]+)$", with: "$1-outline" },
  { pattern: "~$", with: "" },
];

export default {
  id: "material-symbols",
  name: "Material Symbols",
  source: { type: "npm", package: "@material-symbols/svg-400" },
  svgFolders: [
    { path: "outlined", naming: { lowercase: true, replace: base } },
    {
      path: "rounded",
      naming: {
        lowercase: true,
        replace: [...base, { pattern: "$", with: "-rounded" }],
      },
    },
    {
      path: "sharp",
      naming: {
        lowercase: true,
        replace: [...base, { pattern: "$", with: "-sharp" }],
      },
    },
  ],
  palette: "monochrome",
  // Холст источника — 960 со сдвигом (viewBox="0 -960 960 960"), сетка набора — 24.
  grid: 24,
  sourceGrid: 960,
  license: { spdx: "Apache-2.0", file: "LICENSE" },
  // Одинаковые варианты одной иконки — алиасы старшего, как у Iconify (ADR-0002): 360-sharp → 360.
  variantAliases: [
    "",
    "-sharp",
    "-rounded",
    "-outline",
    "-outline-sharp",
    "-outline-rounded",
  ],
} satisfies SourceConfigInput;
