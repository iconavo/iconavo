import type { Metadata } from "next";
import { Licenses } from "../../../components/pages/Licenses";
import { DICTIONARIES } from "../../../lib/i18n";

// Страница статическая: лицензии — из edge API при сборке (ADR-0039).
export const dynamic = "error";

export const metadata: Metadata = { title: DICTIONARIES.en.licensesTitle };

export default function Page() {
  return <Licenses lang="en" />;
}
