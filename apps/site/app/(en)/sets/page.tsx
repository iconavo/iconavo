import type { Metadata } from "next";
import { Sets } from "../../../components/pages/Sets";
import { DICTIONARIES } from "../../../lib/i18n";

// Страница статическая: данные наборов — из edge API при сборке (ADR-0039).
export const dynamic = "error";

export const metadata: Metadata = { title: DICTIONARIES.en.setsTitle };

export default function Page() {
  return <Sets lang="en" />;
}
