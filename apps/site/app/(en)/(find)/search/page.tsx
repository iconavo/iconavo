import type { Metadata } from "next";
import { SearchPage } from "../../../../components/pages/SearchPage";
import { searchMetadata } from "../../../../lib/metadata";

// Страница статическая: запрос читает браузер. Чтение запроса на сервере сделало бы её динамической — это
// ловит строка «Статичность» проверки сайта. dynamic = "error" здесь не годится: он кладёт все запросы
// страницы в кэш запросов Next.js, который переживает выкладки и сбросы (ADR-0039).
export const metadata: Metadata = searchMetadata("en");

export default function Page() {
  return <SearchPage lang="en" />;
}
