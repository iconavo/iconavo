import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Chips } from "./Chips";

const meta = {
  title: "Catalog/Chips",
  component: Chips,
  decorators: [
    (Story) => (
      <div className="page">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Chips>;

export default meta;
type Story = StoryObj<typeof meta>;

const chip = (key: string, label: string, count?: string, current = false) => ({
  key,
  label,
  count,
  href: key === "" ? "/lucide" : `/lucide?category=${key}`,
  current,
  onSelect: () => {},
});

/** Категории автора на странице набора: со счётчиками, выбранная — заливкой. */
export const Categories: Story = {
  args: {
    label: "Categories",
    chips: [
      chip("", "All icons", "1,998", true),
      chip("accessibility", "accessibility", "31"),
      chip("arrows", "arrows", "212"),
      chip("communication", "communication", "86"),
      chip("design", "design", "174"),
    ],
  },
};

/** Фильтр каталога наборов — без счётчиков. */
export const Filter: Story = {
  args: {
    label: "Colors",
    chips: [
      chip("", "All"),
      chip("mono", "Monochrome", undefined, true),
      chip("color", "Multicolor"),
    ],
  },
};
