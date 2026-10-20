import type { SourceConfigInput } from "@iconavo-ui/pipeline";

// Только стиль Flat (ADR-0008). Пакета npm нет, берём git. Файлы лежат на двух уровнях:
// assets/Cat/Flat/cat_flat.svg и с оттенком кожи assets/Waving hand/Dark/Flat/waving_hand_flat_dark.svg.
// Имена как у Iconify: waving-hand (оттенок «default» — без суффикса) и waving-hand-dark, а «ñ»
// пропадает: piñata → piata. Прежнее имя pinata стало алиасом при переименовании (ADR-0018).
export default {
  id: "fluent-emoji-flat",
  name: "Fluent Emoji Flat",
  author: {
    name: "Microsoft Corporation",
    url: "https://github.com/microsoft/fluentui-emoji",
  },
  source: { type: "git", repo: "https://github.com/microsoft/fluentui-emoji" },
  svgFolders: ["assets/*/Flat", "assets/*/*/Flat"].map((path) => ({
    path,
    naming: {
      lowercase: true,
      replace: [
        { pattern: "[()!]", with: "" },
        { pattern: "ñ", with: "" },
        { pattern: "_flat_default$", with: "" },
        { pattern: "_flat_", with: "-" },
        { pattern: "_flat$", with: "" },
        { pattern: "_", with: "-" },
      ],
    },
  })),
  palette: "color",
  grid: 32,
  // Текст лицензии прочитан и подтверждён владельцем 20 октября 2026 (ADR-0017).
  license: {
    spdx: "MIT",
    file: "LICENSE",
    confirmed:
      "1e54e3ddbfa0546869ea8b8736208b780c1db12bd2abc5a916f23d0dcd1f83f9",
  },
  // Ключевые слова и группа — в assets/{эмодзи}/metadata.json, общем для всех оттенков кожи.
  // Оттенки не группируются в варианты — как у Iconify, поэтому карты вариантов нет.
  metadata: "fluent-emoji",
} satisfies SourceConfigInput;
