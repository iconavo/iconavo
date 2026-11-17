import type { SidebarGroup } from "../../lib/catalog-view";

// Наборы для историй фильтров — как их готовит сервер (sidebarGroups): числа уже строками.
export const STORY_GROUPS: SidebarGroup[] = [
  {
    id: "material",
    title: "Material",
    sets: [
      {
        id: "material-symbols",
        name: "Material Symbols",
        count: "15,833",
        license: "Apache-2.0",
      },
    ],
  },
  {
    id: "ui-24",
    title: "UI 24px",
    sets: [
      { id: "lucide", name: "Lucide", count: "2,089", license: "ISC" },
      { id: "tabler", name: "Tabler Icons", count: "6,545", license: "MIT" },
      { id: "ph", name: "Phosphor", count: "9,072", license: "MIT" },
    ],
  },
  {
    id: "emoji",
    title: "Emoji",
    sets: [
      {
        id: "fluent-emoji-flat",
        name: "Fluent Emoji Flat",
        count: "3,145",
        license: "MIT",
      },
    ],
  },
];

export const STORY_LICENSES = ["Apache-2.0", "ISC", "MIT"];
