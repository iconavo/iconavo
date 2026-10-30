import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Pagination } from "./Pagination";

const meta = {
  title: "Catalog/Pagination",
  component: Pagination,
  args: {
    lang: "en",
    hrefOf: (page: number) => (page === 1 ? "/lucide" : `/lucide?page=${page}`),
    onSelect: () => {},
  },
  decorators: [
    (Story) => (
      <div className="page">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Первая страница: «назад» выключено. */
export const First: Story = { args: { page: 1, pages: 21 } };

/** Середина: первая, соседние, последняя и пропуски. */
export const Middle: Story = { args: { page: 10, pages: 21 } };

/** Последняя: «вперёд» выключено. */
export const Last: Story = { args: { page: 21, pages: 21 } };

export const Russian: Story = { args: { lang: "ru", page: 2, pages: 3 } };
