import type { SourceConfigInput } from "@iconavo-ui/pipeline";

// Контур и заливка лежат в разных папках с одинаковыми именами (heart-broken есть в обеих),
// поэтому у заливки суффикс -filled (ADR-0002). Папку categories/ не берём: это копии иконок,
// а категория каждой иконки есть в icons.json вместе с тегами.
export default {
  id: "tabler",
  name: "Tabler Icons",
  author: { name: "Paweł Kuna", url: "https://github.com/tabler/tabler-icons" },
  source: { type: "npm", package: "@tabler/icons" },
  svgFolders: [
    { path: "icons/outline" },
    {
      path: "icons/filled",
      naming: { lowercase: true, replace: [{ pattern: "$", with: "-filled" }] },
    },
  ],
  palette: "monochrome",
  grid: 24,
  // Текст лицензии прочитан и подтверждён владельцем 20 октября 2026 (ADR-0017).
  license: {
    spdx: "MIT",
    file: "LICENSE",
    confirmed:
      "b6615990409a3cfa33094bdc25161ff3b727eeef62cb7a72012d002592400de5",
  },
  metadata: "tabler",
  // Карта вариантов наша: у Iconify её для Tabler нет (ADR-0002).
  suffixes: { "": "Outline", "-filled": "Filled" },
} satisfies SourceConfigInput;
