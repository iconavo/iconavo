import type { Metadata } from "next";
import { Sets } from "../../../../components/pages/Sets";
import { DICTIONARIES } from "../../../../lib/i18n";

export const dynamic = "error";

export const metadata: Metadata = { title: DICTIONARIES.ru.setsTitle };

export default function Page() {
  return <Sets lang="ru" />;
}
