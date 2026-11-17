import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { Lang } from "../lib/i18n";
import { Crumbs } from "./Crumbs";

// Хлебные крошки страниц набора, иконки и поиска: уровни выше — ссылками, текущая — текстом.
const meta = {
  title: "Site/Crumbs",
  component: Crumbs,
  args: {
    lang: "en",
    items: [{ path: "/", label: "Icon Sets" }],
    current: "Search",
  },
  render: (args, { globals }) => (
    <div className="page">
      <Crumbs {...args} lang={globals.lang as Lang} />
    </div>
  ),
} satisfies Meta<typeof Crumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Search: Story = {};

export const IconPage: Story = {
  args: {
    items: [
      { path: "/", label: "Icon Sets" },
      { path: "/lucide", label: "Lucide" },
    ],
    current: "house",
  },
};
