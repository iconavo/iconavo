import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { IconPageData } from "../../lib/icon-page";
import { IconView } from "./IconView";

// Страница иконки по макету Figma «Страница иконки» (редизайн, шаг 4): данные — как их собирает сервер
// из каталога наборов (components/pages/IconPage.tsx). Рисунки похожих и соседей — с живых хостов.
const meta = {
  title: "Icon/IconView",
  component: IconView,
  decorators: [
    (Story) => (
      <main className="page icon-page">
        <Story />
      </main>
    ),
  ],
  parameters: { nextjs: { navigation: { pathname: "/ph/house-bold" } } },
} satisfies Meta<typeof IconView>;

export default meta;
type Story = StoryObj<typeof meta>;

const PH_SET: IconPageData["set"] = {
  prefix: "ph",
  name: "Phosphor",
  author: {
    name: "Phosphor Icons",
    url: "https://github.com/phosphor-icons/core",
  },
  license: {
    title: "MIT",
    spdx: "MIT",
    url: "https://spdx.org/licenses/MIT.html",
  },
  palette: false,
};

const HOUSE: IconPageData = {
  icon: "ph:house-bold",
  card: "ph:house",
  hidden: false,
  set: PH_SET,
  data: {
    body: '<path fill="currentColor" d="m20.826 9.923-7.5-7.5a1.875 1.875 0 00-2.652 0l-7.5 7.5a1.86 1.86 0 00-.549 1.327v9a1.125 1.125 0 001.125 1.125h6a1.125 1.125 0 001.125-1.125v-4.875h2.25v4.875a1.125 1.125 0 001.125 1.125h6a1.125 1.125 0 001.125-1.125v-9a1.86 1.86 0 00-.55-1.327m-1.701 9.202h-3.75V14.25a1.125 1.125 0 00-1.125-1.125h-4.5a1.125 1.125 0 00-1.125 1.125v4.875h-3.75v-7.72L12 4.28l7.125 7.125Z"/>',
    left: 0,
    top: 0,
    width: 24,
    height: 24,
  },
  strokes: false,
  categories: [{ title: "Objects", slug: "objects" }],
  tiles: {
    kind: "styles",
    items: [
      { name: "ph:house-thin", label: "Thin" },
      { name: "ph:house-light", label: "Light" },
      { name: "ph:house", label: "Regular" },
      { name: "ph:house-bold", label: "Bold" },
      { name: "ph:house-fill", label: "Fill" },
      { name: "ph:house-duotone", label: "Duotone" },
    ],
  },
  dates: { added: "October 25, 2026", changed: "November 3, 2026" },
  details: {
    icon: "ph:house-bold",
    set: PH_SET,
    card: "ph:house",
    style: "outline",
    variants: [],
    tones: [],
    strokes: false,
    description: {
      en: "A simple house with a pitched roof and a door.",
      ru: "Простой дом с двускатной крышей и дверью.",
    },
    synonyms: { en: ["home", "building"], ru: ["дом", "здание"] },
    tags: [
      "home",
      "house",
      "building",
      "residence",
      "dwelling",
      "property",
      "real estate",
      "roof",
      "door",
      "address",
    ],
    similar: [
      "lucide:house",
      "tabler:home",
      "material-symbols:home-outline",
      "lucide:house-plus",
      "tabler:home-2",
      "material-symbols:cottage",
      "ph:buildings",
    ],
  },
  label: "Home",
  neighbours: [
    { icon: "ph:magnifying-glass-bold", label: "Search" },
    { icon: "ph:gear-bold", label: "Settings" },
  ],
  setNames: {
    ph: "Phosphor",
    lucide: "Lucide",
    tabler: "Tabler Icons",
    "material-symbols": "Material Symbols",
  },
};

export const Ready: Story = { args: { lang: "en", page: HOUSE } };

/** Поиск при сборке страницы не ответил: теги и похожие спрашивает браузер. */
export const NoSearch: Story = {
  args: {
    lang: "en",
    page: { ...HOUSE, details: undefined, dates: {} },
  },
};

export const Russian: Story = {
  args: {
    lang: "ru",
    page: {
      ...HOUSE,
      label: "Дом",
      dates: { added: "25 октября 2026 г." },
      neighbours: [
        { icon: "ph:magnifying-glass-bold", label: "Поиск" },
        { icon: "ph:gear-bold", label: "Настройки" },
      ],
    },
  },
  parameters: { nextjs: { navigation: { pathname: "/ru/ph/house-bold" } } },
};

/** Автор убрал иконку: имя работает, иконка скрыта (ADR-0018). */
export const Removed: Story = {
  args: {
    lang: "en",
    page: {
      ...HOUSE,
      icon: "lucide:circle-parking",
      card: null,
      hidden: true,
      set: {
        prefix: "lucide",
        name: "Lucide",
        author: {
          name: "Lucide Contributors",
          url: "https://github.com/lucide-icons/lucide",
        },
        license: { title: "ISC", spdx: "ISC" },
        palette: false,
      },
      data: {
        body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 17V7h4a3 3 0 010 6H9"/></g>',
        left: 0,
        top: 0,
        width: 24,
        height: 24,
      },
      strokes: true,
      categories: [],
      tiles: { kind: "styles", items: [] },
      dates: { removed: "October 30, 2026" },
      removedIn: "81875c8",
      details: undefined,
    },
  },
  parameters: {
    nextjs: { navigation: { pathname: "/lucide/circle-parking" } },
  },
};
