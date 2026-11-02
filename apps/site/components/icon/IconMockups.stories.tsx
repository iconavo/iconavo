import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IconMockups } from "./IconMockups";

// Мокапы страницы иконки (шаг 4 фазы 4, ADR-0041): восемь мест интерфейса в светлой и тёмной теме.
// Настройки — из хранилища вкладки (lib/icon-settings.ts), иконки — с живых хостов.
const meta = {
  title: "Icon/IconMockups",
  component: IconMockups,
  decorators: [
    (Story) => (
      <div className="page icon-page">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IconMockups>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Outline: Story = {
  args: {
    lang: "en",
    icon: "lucide:house",
    label: "Home",
    neighbours: [
      { icon: "lucide:search", label: "Search" },
      { icon: "lucide:settings", label: "Settings" },
      { icon: "lucide:user", label: "Profile" },
      { icon: "lucide:heart", label: "Favorites" },
    ],
    palette: false,
    strokes: true,
  },
};

export const FilledRussian: Story = {
  args: {
    lang: "ru",
    icon: "ph:house-fill",
    label: "Дом",
    neighbours: [
      { icon: "ph:magnifying-glass-fill", label: "Поиск" },
      { icon: "ph:gear-fill", label: "Настройки" },
      { icon: "ph:user-fill", label: "Профиль" },
      { icon: "ph:heart-fill", label: "Избранное" },
    ],
    palette: false,
    strokes: false,
  },
};

export const Colorful: Story = {
  args: {
    lang: "en",
    icon: "fluent-emoji-flat:house",
    label: "House",
    neighbours: [
      {
        icon: "fluent-emoji-flat:magnifying-glass-tilted-left",
        label: "Search",
      },
      { icon: "fluent-emoji-flat:gear", label: "Settings" },
      { icon: "fluent-emoji-flat:person", label: "Profile" },
    ],
    palette: true,
    strokes: false,
  },
};
