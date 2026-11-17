import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { filterSheetStore } from "../../lib/filter-sheet";
import type { Lang } from "../../lib/i18n";
import { FilterButton, FilterSheet } from "./FilterSheet";
import { STORY_GROUPS, STORY_LICENSES } from "./story-data";

// Шторка фильтра страницы поиска на телефоне (кадр «Search Results / Mobile — Filter»): разделы Sets,
// Style и License, выбор — черновик до Show results. Кнопка с ползунками показывает счётчик выбранного.
const meta = {
  title: "Search/FilterSheet",
  component: FilterSheet,
  args: {
    lang: "en",
    groups: STORY_GROUPS,
    licenses: STORY_LICENSES,
    value: { sets: ["ph"], licenses: [] },
    onApply: () => {},
  },
  render: (args, { globals }) => (
    <>
      <FilterButton lang={globals.lang as Lang} />
      <FilterSheet {...args} lang={globals.lang as Lang} />
    </>
  ),
  beforeEach: () => {
    filterSheetStore.setCount(1);
    filterSheetStore.set(true);
    return () => {
      filterSheetStore.set(false);
      filterSheetStore.setCount(0);
    };
  },
} satisfies Meta<typeof FilterSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneSet: Story = {};

/** Набор, стиль и лицензия: «3 selected». */
export const Several: Story = {
  args: { value: { sets: ["lucide"], licenses: ["ISC"], style: "outline" } },
};
