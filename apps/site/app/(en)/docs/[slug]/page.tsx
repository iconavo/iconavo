import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPage } from "../../../../components/DocPage";
import { docPage, docPages } from "../../../../lib/docs";

// Страницы документации собираются при сборке; другого адреса под /docs нет.
export const dynamicParams = false;

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
