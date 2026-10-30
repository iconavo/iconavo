import type { Metadata } from "next";
import { SetPage } from "../../../components/pages/SetPage";
import { getSets } from "../../../lib/catalog";
import { setMetadata } from "../../../lib/catalog-view";

// Страницы наборов собираются при сборке — по одной на набор из /collections edge API. Неизвестный
// адрес — 404 без запуска функции; новый набор появится после пересборки, а она идёт после каждой
// «Выкладки» (ADR-0039).
export const dynamic = "error";
export const dynamicParams = false;

type Props = { params: Promise<{ prefix: string }> };

export async function generateStaticParams() {
  return Object.keys(await getSets()).map((prefix) => ({ prefix }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return setMetadata("en", (await params).prefix);
}

export default async function Page({ params }: Props) {
  return <SetPage lang="en" prefix={(await params).prefix} />;
}
