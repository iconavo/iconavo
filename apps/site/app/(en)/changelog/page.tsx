import type { Metadata } from "next";
import { Changelog } from "../../../components/pages/Changelog";
import { DICTIONARIES } from "../../../lib/i18n";

// Страница статическая: выпуски — из edge API при сборке (ADR-0039).
export const dynamic = "error";

export const metadata: Metadata = { title: DICTIONARIES.en.newsTitle };

export default function Page() {
  return <Changelog lang="en" />;
}
