import type { Metadata } from "next";
import { Changelog } from "../../../components/pages/Changelog";
import { DICTIONARIES } from "../../../lib/i18n";

// Страница статическая: выпуски — из edge API при сборке; выпуск набора сбрасывает её кэш (метка catalog),
// и она собирается заново при следующем открытии (ADR-0039).
export const metadata: Metadata = { title: DICTIONARIES.en.newsTitle };

export default function Page() {
  return <Changelog lang="en" />;
}
