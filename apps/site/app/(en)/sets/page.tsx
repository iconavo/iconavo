import type { Metadata } from "next";
import { Sets } from "../../../components/pages/Sets";
import { DICTIONARIES } from "../../../lib/i18n";

// Страница статическая: данные наборов — из edge API при сборке; выпуск набора сбрасывает её кэш (метка
// catalog), и она собирается заново при следующем открытии (ADR-0039).
export const metadata: Metadata = { title: DICTIONARIES.en.setsTitle };

export default function Page() {
  return <Sets lang="en" />;
}
