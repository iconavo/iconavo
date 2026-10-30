import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ReleaseItem, type ReleaseView } from "./ReleaseItem";

// Выпуск — как его готовит сервер (lib/catalog-view.ts): дата, числа и подписи уже на языке страницы.
const meta = {
  title: "Catalog/ReleaseItem",
  component: ReleaseItem,
  decorators: [
    (Story) => (
      <div className="page">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReleaseItem>;

export default meta;
type Story = StoryObj<typeof meta>;

const UPDATE: ReleaseView = {
  id: "lucide-8d1ee623",
  prefix: "lucide",
  setName: "Lucide",
  iso: "2026-10-30T11:28:10Z",
  date: "October 30, 2026",
  revision: "81875c8",
  total: "1,998",
  first: false,
  preview: ["house", "heart", "star"],
  lists: [
    {
      kind: "added",
      label: "Added",
      count: "3",
      names: ["house", "heart", "star"],
    },
    {
      kind: "renamed",
      label: "Renamed",
      count: "1",
      names: ["bold → letter-b"],
    },
  ],
};

export const Update: Story = { args: { lang: "en", release: UPDATE } };

/** Первая запись журнала: набор появился в каталоге. */
export const FirstRelease: Story = {
  args: {
    lang: "ru",
    release: {
      ...UPDATE,
      id: "tabler-0f3c2a11",
      prefix: "tabler",
      setName: "Tabler Icons",
      date: "17 октября 2026 г.",
      revision: "3.35.0",
      total: "5 986",
      first: true,
      preview: [],
      lists: [],
    },
  },
  parameters: { nextjs: { navigation: { pathname: "/ru/changelog" } } },
};
