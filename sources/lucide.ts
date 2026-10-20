import type { SourceConfigInput } from "@iconavo-ui/pipeline";

// Берём git, а не npm-пакет lucide-static: в пакете лежат ещё и копии под старыми
// именами (дубли), а в репозитории у каждой иконки есть JSON с тегами и алиасами.
// LICENSE — ISC и раздел MIT для иконок, пришедших из Feather: SPDX у автора — ISC.
export default {
  id: "lucide",
  name: "Lucide",
  author: {
    name: "Lucide Contributors",
    url: "https://github.com/lucide-icons/lucide",
  },
  // Последняя версия — свежий выпуск (тег вида 1.60.0), как у Iconify, а не коммит в main автора:
  // там бывают иконки, которые до выпуска ещё переименуют, а имена у нас не пропадают (ADR-0005).
  source: {
    type: "git",
    repo: "https://github.com/lucide-icons/lucide",
    latest: "tag",
  },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  grid: 24,
  // Текст лицензии прочитан и подтверждён владельцем 20 октября 2026 (ADR-0017).
  license: {
    spdx: "ISC",
    file: "LICENSE",
    confirmed:
      "8a1de583a86b897d2dce83c290a1ff5facd1248bba3355bcfe309839be1e0828",
  },
  metadata: "lucide",
} satisfies SourceConfigInput;
