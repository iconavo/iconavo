import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IconGrid } from "./IconGrid";

// Сетка набора: первая страница — из пропсов, как с сервера; другие страницы, категории и стили история
// берёт у живого api.iconavo.dev (/collection), иконки — с живых хостов.
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
  styles: [{ style: "outline" as const, size: 1998, count: "1,998" }],
};

export const Lucide: Story = { args: LUCIDE };

/** Набор с несколькими стилями — чипсы «Стиль»: карточки показывают главное имя выбранного стиля. */
export const Phosphor: Story = {
  args: {
    ...LUCIDE,
    prefix: "ph",
    first: [
      "acorn",
      "address-book",
      "address-book-tabs",
      "air-traffic-control",
    ],
    total: 1512,
    allCount: "1,512",
    categories: [],
    styles: [
      { style: "outline", size: 1512, count: "1,512" },
      { style: "filled", size: 1512, count: "1,512" },
      { style: "duotone", size: 1512, count: "1,512" },
    ],
  },
  parameters: { nextjs: { navigation: { pathname: "/ph" } } },
};

/** Без категорий автора — как у Material Symbols: только сетка. */
export const NoCategories: Story = {
  args: { ...LUCIDE, lang: "ru", categories: [], allCount: "1 998" },
  parameters: { nextjs: { navigation: { pathname: "/ru/lucide" } } },
};
