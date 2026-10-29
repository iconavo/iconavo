import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPage } from "../../components/DocPage";
import { docPage, docPages } from "../../lib/docs";

const page = docPage("");

export const metadata: Metadata = page
  ? { title: page.title, description: page.description }
  : {};

export default function QuickStart() {
  if (!page) notFound();
  return <DocPage page={page} pages={docPages()} />;
}
