import type { ReactNode } from "react";
import { HomeIntro } from "../../../components/home/HomeIntro";
import { SearchHero } from "../../../components/search/SearchHero";
import { PAGE_PANEL_ID } from "../../../lib/panel-layout";

// Общая раскладка главной и поиска (шаг 3 фазы 4): большое поле поиска живёт здесь и не пересоздаётся
// при переходе с главной на /search — фокус и набранные буквы остаются (решение владельца). Начало главной
// по макету (HomeIntro) — серверная разметка: поле показывает его только на главной.
export default function FindLayout({ children }: { children: ReactNode }) {
  return (
    <main id="content" className="page find-page">
      <div className="hero">
        <SearchHero lang="en" intro={<HomeIntro lang="en" />} />
      </div>
      <div className="find-body">{children}</div>
      {/* Место панели иконки во всю высоту страницы (lib/panel-layout.ts); на главной панели нет. */}
      <div id={PAGE_PANEL_ID} className="page-panel" />
    </main>
  );
}
