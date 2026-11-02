import type { Metadata } from "next";
import {
  IconPage,
  iconMetadata,
} from "../../../../../components/pages/IconPage";

// Русские страницы иконок — в русской раскладке, как страницы наборов (ADR-0037); создаются при первом
// открытии и хранятся в кэше (ADR-0039).
export const revalidate = false;

type Props = { params: Promise<{ prefix: string; icon: string }> };

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { prefix, icon } = await params;
  return iconMetadata("ru", prefix, icon);
}

export default async function Page({ params }: Props) {
  const { prefix, icon } = await params;
  return <IconPage lang="ru" prefix={prefix} icon={icon} />;
}
