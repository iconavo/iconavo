import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SetCard } from "./SetCard";

// Данные — как их готовит сервер (lib/catalog-view.ts): числа уже строками на языке страницы. Иконки
// витрины история берёт с живых хостов.
const meta = {
  title: "Catalog/SetCard",
  component: SetCard,
  decorators: [
    (Story) => (
      <div className="page set-grid">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SetCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const LUCIDE = {
  id: "lucide",
  name: "Lucide",
  total: "1,998 icons",
  author: "Lucide Contributors",
  license: "ISC",
  licenseId: "ISC",
  palette: false,
  samples: ["house", "search", "settings", "user", "heart", "star"],
};

export const Monochrome: Story = { args: { lang: "en", set: LUCIDE } };

export const Multicolor: Story = {
  args: {
    lang: "en",
    set: {
      id: "fluent-emoji-flat",
      name: "Fluent Emoji Flat",
      total: "3,145 icons",
      author: "Microsoft Corporation",
      license: "MIT",
      licenseId: "MIT",
      palette: true,
      samples: [
        "house",
        "magnifying-glass-tilted-left",
        "gear",
        "person",
        "red-heart",
        "star",
      ],
    },
  },
};

export const Russian: Story = {
  args: { lang: "ru", set: { ...LUCIDE, total: "1 998 иконок" } },
  parameters: { nextjs: { navigation: { pathname: "/ru/sets" } } },
};
