import type { Metadata } from "next";
import { IconPage, iconMetadata } from "../../../../components/pages/IconPage";

// Страницы иконок — десятки тысяч: при сборке их нет, каждая создаётся при первом открытии и хранится в
// кэше до сброса метки её набора или до следующей выкладки (ADR-0039).
export const revalidate = false;

type Props = { params: Promise<{ prefix: string; icon: string }> };

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { prefix, icon } = await params;
  return iconMetadata("en", prefix, icon);
}

export default async function Page({ params }: Props) {
  const { prefix, icon } = await params;
  return <IconPage lang="en" prefix={prefix} icon={icon} />;
}
