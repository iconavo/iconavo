import type { Metadata } from "next";
import { Changelog } from "../../../../components/pages/Changelog";
import { DICTIONARIES } from "../../../../lib/i18n";

export const dynamic = "error";

export const metadata: Metadata = { title: DICTIONARIES.ru.newsTitle };

export default function Page() {
  return <Changelog lang="ru" />;
}
