import type { Metadata } from "next";
import { AccountPage } from "../../../../components/pages/Account";
import { accountMetadata } from "../../../../lib/metadata";

export const metadata: Metadata = accountMetadata("ru");

export default function Page() {
  return <AccountPage lang="ru" />;
}
