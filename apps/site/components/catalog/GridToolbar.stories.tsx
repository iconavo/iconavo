import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { GridBar } from "./GridBar";
import { GridToolbar } from "./GridToolbar";
import { Pagination } from "./Pagination";

// Панель над сеткой набора и строка номеров страниц — по макету Figma «Iconavo — Макеты» (Icon Set Page).
const meta = {
  title: "Catalog/GridToolbar",
  component: GridToolbar,
  decorators: [
    (Story) => (
      <div className="page set-browser">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GridToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { lang: "en", setName: "Lucide", query: "", onQuery: () => {} },
};

export const WithQuery: Story = {
  args: { lang: "ru", setName: "Lucide", query: "arrow", onQuery: () => {} },
};

export const PagesBar: StoryObj<typeof GridBar> = {
  name: "GridBar",
  render: () => (
    <GridBar lang="en" top perPage={98}>
      <Pagination
        lang="en"
        page={3}
        pages={22}
        hrefOf={(p) => `?page=${p}`}
        onSelect={() => {}}
      />
    </GridBar>
  ),
};
