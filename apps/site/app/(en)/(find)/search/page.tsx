import type { Metadata } from "next";
import { SearchPage } from "../../../../components/pages/SearchPage";
import { searchMetadata } from "../../../../lib/metadata";

// Страница статическая: запрос читает браузер. Попытка прочитать его на сервере уронит сборку.
export const dynamic = "error";

export const metadata: Metadata = searchMetadata("en");

export default function Page() {
  return <SearchPage lang="en" />;
}
