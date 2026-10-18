import type { SourceConfigInput } from "@iconavo-ui/pipeline";

// Контур и заливка лежат в разных папках с одинаковыми именами (heart-broken есть в обеих),
// поэтому у заливки суффикс -filled (ADR-0002). Папку categories/ не берём: это копии иконок.
export default {
  id: "tabler",
  name: "Tabler Icons",
  source: { type: "npm", package: "@tabler/icons" },
  svgFolders: [
    { path: "icons/outline" },
    {
      path: "icons/filled",
      naming: { lowercase: true, replace: [{ pattern: "$", with: "-filled" }] },
    },
  ],
  palette: "monochrome",
  license: { spdx: "MIT", file: "LICENSE" },
} satisfies SourceConfigInput;
