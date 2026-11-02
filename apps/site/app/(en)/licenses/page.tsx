import type { Metadata } from "next";
import { Licenses } from "../../../components/pages/Licenses";
import { DICTIONARIES } from "../../../lib/i18n";

// Страница статическая: лицензии — из edge API при сборке; выпуск набора сбрасывает её кэш (метка catalog),
// и она собирается заново при следующем открытии (ADR-0039).
export const metadata: Metadata = { title: DICTIONARIES.en.licensesTitle };

export default function Page() {
  return <Licenses lang="en" />;
}
