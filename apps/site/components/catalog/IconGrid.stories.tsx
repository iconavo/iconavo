import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IconGrid } from "./IconGrid";

// Сетка набора: первая страница — из пропсов, как с сервера; другие страницы и категории история берёт
// у живого api.iconavo.dev (/collection), иконки — с живых хостов.
const meta = {
  title: "Catalog/IconGrid",
  component: IconGrid,
  parameters: { nextjs: { navigation: { pathname: "/lucide" } } },
  decorators: [
    (Story) => (
      <div className="page">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IconGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

const LUCIDE = {
  lang: "en" as const,
  prefix: "lucide",
  first: [
    "a-arrow-down",
    "a-arrow-up",
    "a-large-small",
    "accessibility",
    "activity",
    "air-vent",
    "airplay",
    "alarm-clock",
    "alarm-clock-check",
    "alarm-clock-minus",
    "alarm-clock-off",
    "alarm-clock-plus",
    "alarm-smoke",
    "align-center-horizontal",
    "align-center-vertical",
    "align-end-horizontal",
  ],
  total: 1998,
  allCount: "1,998",
  categories: [
    { slug: "accessibility", title: "accessibility", size: 31, count: "31" },
    { slug: "arrows", title: "arrows", size: 212, count: "212" },
    { slug: "design", title: "design", size: 174, count: "174" },
  ],
};

export const Lucide: Story = { args: LUCIDE };

/** Без категорий автора — как у Material Symbols: только сетка. */
export const NoCategories: Story = {
  args: { ...LUCIDE, lang: "ru", categories: [], allCount: "1 998" },
  parameters: { nextjs: { navigation: { pathname: "/ru/lucide" } } },
};
