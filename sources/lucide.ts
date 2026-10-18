import type { SourceConfigInput } from "@iconavo-ui/pipeline";

// Берём git, а не npm-пакет lucide-static: в пакете лежат ещё и копии под старыми
// именами (дубли), а в репозитории у каждой иконки есть JSON с тегами и алиасами.
export default {
  id: "lucide",
  name: "Lucide",
  source: { type: "git", repo: "https://github.com/lucide-icons/lucide" },
  svgFolders: [{ path: "icons" }],
  palette: "monochrome",
  license: { spdx: "ISC", file: "LICENSE" },
  iconMetadata: "json",
} satisfies SourceConfigInput;
