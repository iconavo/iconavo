import type { SourceConfigInput } from "@iconavo-ui/pipeline";

// Шесть начертаний (ADR-0008). Суффиксы уже есть в именах файлов (house-bold.svg),
// у обычного начертания суффикса нет (house.svg).
export default {
  id: "ph",
  name: "Phosphor",
  source: { type: "npm", package: "@phosphor-icons/core" },
  svgFolders: ["thin", "light", "regular", "bold", "fill", "duotone"].map(
    (weight) => ({ path: `assets/${weight}` }),
  ),
  palette: "monochrome",
  // Холст источника — 256, сетка набора — 24 (ADR-0014; Iconify оставляет 256).
  grid: 24,
  sourceGrid: 256,
  license: { spdx: "MIT", file: "LICENSE" },
} satisfies SourceConfigInput;
