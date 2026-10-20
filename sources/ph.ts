import type { SourceConfigInput } from "@iconavo-ui/pipeline";

// Шесть начертаний (ADR-0008). Суффиксы уже есть в именах файлов (house-bold.svg),
// у обычного начертания суффикса нет (house.svg).
export default {
  id: "ph",
  name: "Phosphor",
  author: {
    name: "Phosphor Icons",
    url: "https://github.com/phosphor-icons/core",
  },
  source: { type: "npm", package: "@phosphor-icons/core" },
  svgFolders: ["thin", "light", "regular", "bold", "fill", "duotone"].map(
    (weight) => ({ path: `assets/${weight}` }),
  ),
  palette: "monochrome",
  // Холст источника — 256, сетка набора — 24 (ADR-0014; Iconify оставляет 256).
  grid: 24,
  sourceGrid: 256,
  // Текст лицензии прочитан и подтверждён владельцем 20 октября 2026 (ADR-0017).
  license: {
    spdx: "MIT",
    file: "LICENSE",
    confirmed:
      "d21ba4521bc09600cce6998f980f67898f0b5e2724ef429d20a13cd5cbc25968",
  },
  // Теги и категории — в массиве иконок модуля dist/index.mjs (читается как текст, без запуска).
  metadata: "phosphor",
  // Названия начертаний — как у Iconify.
  suffixes: {
    "": "Regular",
    "-thin": "Thin",
    "-light": "Light",
    "-bold": "Bold",
    "-fill": "Fill",
    "-duotone": "Duotone",
  },
} satisfies SourceConfigInput;
