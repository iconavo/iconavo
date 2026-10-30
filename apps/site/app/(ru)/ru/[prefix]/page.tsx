import type { Metadata } from "next";
import { SetPage } from "../../../../components/pages/SetPage";
import { getSets } from "../../../../lib/catalog";
import { setMetadata } from "../../../../lib/catalog-view";

// Русские страницы наборов — в русской раскладке: адрес /ru/xyz не попадёт в английский [набор]/[иконка]
// шага 4 (ADR-0037).
export const dynamic = "error";
export const dynamicParams = false;

type Props = { params: Promise<{ prefix: string }> };

export async function generateStaticParams() {
  return Object.keys(await getSets()).map((prefix) => ({ prefix }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return setMetadata("ru", (await params).prefix);
}

export default async function Page({ params }: Props) {
  return <SetPage lang="ru" prefix={(await params).prefix} />;
}
