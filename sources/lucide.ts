import type { SourceConfigInput } from "@iconavo-ui/pipeline";

export default {
  id: "lucide",
  name: "Lucide",
  source: { type: "npm", package: "lucide-static" },
  svgPath: "icons",
  naming: { lowercase: true, replace: [] },
  palette: "monochrome",
  license: { spdx: "ISC", file: "LICENSE" },
  tagsFile: "tags.json",
} satisfies SourceConfigInput;
