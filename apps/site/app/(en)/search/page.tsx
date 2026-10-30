import type { Metadata } from "next";
import { SearchSoon } from "../../../components/pages/SearchSoon";
import { DICTIONARIES } from "../../../lib/i18n";

// Страница статическая: попытка прочитать запрос уронит сборку, а не только проверку сайта.
export const dynamic = "error";

export const metadata: Metadata = { title: DICTIONARIES.en.searchTitle };

export default function Page() {
  return <SearchSoon lang="en" />;
}
