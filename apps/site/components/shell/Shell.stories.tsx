import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { SidebarGroup } from "../../lib/catalog-view";
import { Sidebar } from "./Sidebar";
import { Soon } from "./Soon";
import { ThemeToggle } from "./ThemeToggle";
import { TopBar } from "./TopBar";

// Каркас по макету Figma «Iconavo — Макеты». Наборы — как их готовит сервер (sidebarGroups): числа уже
// строками на языке страницы.
const GROUPS: SidebarGroup[] = [
  {
    id: "material",
    title: "Material",
    sets: [
      {
        id: "material-symbols",
        name: "Material Symbols",
        count: "15,802",
        license: "Apache-2.0",
      },
    ],
  },
  {
    id: "ui-24",
    title: "UI 24px",
    sets: [
      { id: "lucide", name: "Lucide", count: "2,029", license: "ISC" },
      { id: "tabler", name: "Tabler Icons", count: "6,287", license: "MIT" },
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

const meta = {
  title: "Shell/Sidebar",
  component: Sidebar,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/lucide" } },
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnSetPage: Story = { args: { lang: "en", groups: GROUPS } };

export const Russian: Story = {
  args: { lang: "ru", groups: GROUPS },
  parameters: { nextjs: { navigation: { pathname: "/ru" } } },
};

export const TopBarStory: StoryObj<typeof TopBar> = {
  name: "TopBar",
  render: () => <TopBar lang="en" />,
  parameters: { nextjs: { navigation: { pathname: "/" } } },
};

export const SoonStory: StoryObj<typeof Soon> = {
  name: "Soon",
  render: () => (
    <p>
      <Soon lang="en" className="pill">
        Extensions
      </Soon>
    </p>
  ),
};

export const ThemeToggleStory: StoryObj<typeof ThemeToggle> = {
  name: "ThemeToggle",
  render: () => <ThemeToggle lang="en" />,
};
