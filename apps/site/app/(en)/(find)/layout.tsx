import type { ReactNode } from "react";
import { SearchHero } from "../../../components/search/SearchHero";

// Общая раскладка главной и поиска (шаг 3 фазы 4): большое поле поиска живёт здесь и не пересоздаётся
// при переходе с главной на /search — фокус и набранные буквы остаются (решение владельца).
export default function FindLayout({ children }: { children: ReactNode }) {
  return (
    <main id="content" className="container page find-page">
      <SearchHero lang="en" />
      {children}
    </main>
  );
}
