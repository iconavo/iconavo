import type { Metadata } from "next";
import { Licenses } from "../../../../components/pages/Licenses";
import { DICTIONARIES } from "../../../../lib/i18n";

export const dynamic = "error";

export const metadata: Metadata = { title: DICTIONARIES.ru.licensesTitle };

export default function Page() {
  return <Licenses lang="ru" />;
}
