import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ResultGrid } from "./ResultGrid";

// Сетка выдачи поиска: карточки — как их разбирает lib/search.ts из ответа /search, иконки — с живых
// хостов. Скелетоны добивают страницу, пока смысл досчитывается.
const meta = {
  title: "Search/ResultGrid",
  component: ResultGrid,
  decorators: [
    (Story) => (
      <div className="page">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ResultGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

const TITLES = {
  lucide: "Lucide",
  ph: "Phosphor",
  tabler: "Tabler Icons",
  "material-symbols": "Material Symbols",
};

const CARDS = [
  {
    card: "lucide:house",
    icon: "lucide:house",
    set: "lucide",
    name: "house",
    exact: true,
  },
  { card: "ph:house", icon: "ph:house", set: "ph", name: "house", exact: true },
  {
    card: "tabler:home",
    icon: "tabler:home",
    set: "tabler",
    name: "home",
    exact: false,
  },
  {
    card: "material-symbols:home-app-logo",
    icon: "material-symbols:home-app-logo",
    set: "material-symbols",
    name: "home-app-logo",
    exact: false,
  },
];

export const Results: Story = {
  args: { lang: "en", cards: CARDS, setTitles: TITLES },
};

/** Выдача по словам, смысл досчитывается: скелетоны держат место полной страницы. */
export const Refining: Story = {
  args: {
    lang: "ru",
    cards: CARDS.slice(0, 2),
    skeletons: 10,
    setTitles: TITLES,
  },
};

/** Новый запрос: прежняя выдача бледнеет. */
export const Busy: Story = {
  args: { lang: "en", cards: CARDS, setTitles: TITLES, busy: true },
};
