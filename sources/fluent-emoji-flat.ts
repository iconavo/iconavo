import type { SourceConfigInput } from "@iconavo-ui/pipeline";

// Только стиль Flat (ADR-0008). Пакета npm нет, берём git. Файлы лежат на двух уровнях:
// assets/Cat/Flat/cat_flat.svg и с оттенком кожи assets/Waving hand/Dark/Flat/waving_hand_flat_dark.svg.
// Имена как у Iconify: waving-hand (оттенок «default» — без суффикса) и waving-hand-dark.
export default {
  id: "fluent-emoji-flat",
  name: "Fluent Emoji Flat",
  source: { type: "git", repo: "https://github.com/microsoft/fluentui-emoji" },
  svgFolders: ["assets/*/Flat", "assets/*/*/Flat"].map((path) => ({
    path,
    naming: {
      lowercase: true,
      replace: [
        { pattern: "[()!]", with: "" },
        { pattern: "ñ", with: "n" },
        { pattern: "_flat_default$", with: "" },
        { pattern: "_flat_", with: "-" },
        { pattern: "_flat$", with: "" },
        { pattern: "_", with: "-" },
      ],
    },
  })),
  palette: "color",
  grid: 32,
  license: { spdx: "MIT", file: "LICENSE" },
} satisfies SourceConfigInput;
