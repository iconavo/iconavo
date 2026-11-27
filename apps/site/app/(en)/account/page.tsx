import type { Metadata } from "next";
import { AccountPage } from "../../../components/pages/Account";
import { accountMetadata } from "../../../lib/metadata";

// Кабинет (шаг 3 фазы 5, PR 4): страница статическая, данные — в браузере; не индексируется никогда.
export const metadata: Metadata = accountMetadata("en");

export default function Page() {
  return <AccountPage lang="en" />;
}
