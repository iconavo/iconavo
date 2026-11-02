import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPage } from "../../../../components/DocPage";
import { docPage, docPages } from "../../../../lib/docs";

// Страницы документации собираются при сборке. Неизвестный раздел — 404 через notFound() ниже, а не
// dynamicParams = false: с маршрутом страницы иконки /[prefix]/[icon] (шаг 4 фазы 4) Vercel отвечал на
// /docs/x ошибкой 500 — его маршрутизация не подхватывает отказ Next.js «нет такой заранее собранной
// страницы», а next start подхватывает, поэтому pnpm site --check этого не видит (ловит --live).

export function generateStaticParams() {
  return docPages()
    .filter((p) => p.slug !== "")
    .map((p) => ({ slug: p.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = docPage((await params).slug);
  return page ? { title: page.title, description: page.description } : {};
}

export default async function Page({ params }: Props) {
  const page = docPage((await params).slug);
  if (!page) notFound();
  return <DocPage page={page} pages={docPages()} />;
}
