import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SearchHero } from "./SearchHero";

// Поле поиска главной и страницы поиска: заголовок зависит от адреса.
const meta = {
  title: "Search/SearchHero",
  component: SearchHero,
  decorators: [
    (Story) => (
      <div className="page">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SearchHero>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {
  args: { lang: "en" },
  parameters: { nextjs: { navigation: { pathname: "/" } } },
};

export const SearchPage: Story = {
  args: { lang: "ru" },
  parameters: { nextjs: { navigation: { pathname: "/ru/search" } } },
};
