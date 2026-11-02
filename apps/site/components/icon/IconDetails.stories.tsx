import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { IconDetails as Details } from "../../lib/icon";
import { IconDetails } from "./IconDetails";

// Сведения об иконке — как их отдаёт /icon edge API (шаг 4 фазы 4): одно содержимое у боковой панели и
// страницы иконки. Иконки — с живых хостов.
const meta = {
  title: "Icon/IconDetails",
  component: IconDetails,
  decorators: [
    (Story) => (
      <div className="page icon-page">
        <Story />
      </div>
    ),
  ],
  parameters: { nextjs: { navigation: { pathname: "/ph/house-bold" } } },
} satisfies Meta<typeof IconDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

const PHOSPHOR: Details = {
  icon: "ph:house-bold",
  set: {
    prefix: "ph",
    name: "Phosphor",
    author: {
      name: "Phosphor Icons",
      url: "https://github.com/phosphor-icons/core",
    },
    license: {
      title: "MIT",
      spdx: "MIT",
      url: "https://spdx.org/licenses/MIT.html",
    },
    palette: false,
  },
  card: "ph:house",
  style: "outline",
  variants: [
    {
      style: "outline",
      icons: ["ph:house-thin", "ph:house-light", "ph:house", "ph:house-bold"],
    },
    { style: "filled", icons: ["ph:house-fill"] },
    { style: "duotone", icons: ["ph:house-duotone"] },
  ],
  tones: [],
  strokes: false,
  description: {
    en: "A simple house with a pitched roof and a door.",
    ru: "Простой дом с двускатной крышей и дверью.",
  },
  synonyms: {
    en: ["home", "building", "dwelling"],
    ru: ["дом", "здание", "жилище"],
  },
  tags: ["home", "building"],
  similar: ["lucide:house", "tabler:home", "material-symbols:home-outline"],
};

export const Panel: Story = {
  args: {
    lang: "en",
    icon: PHOSPHOR.icon,
    details: PHOSPHOR,
    state: "ready",
    mode: "panel",
  },
};

export const PageRussian: Story = {
  args: {
    lang: "ru",
    icon: PHOSPHOR.icon,
    details: PHOSPHOR,
    state: "ready",
    mode: "page",
  },
};

export const Loading: Story = {
  args: {
    lang: "en",
    icon: "lucide:house",
    details: undefined,
    state: "loading",
    mode: "panel",
  },
};
