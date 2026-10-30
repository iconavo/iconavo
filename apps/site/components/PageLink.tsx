import Link from "next/link";
import type { ComponentProps } from "react";
import { href, type Lang, langOf } from "../lib/i18n";

/**
 * Ссылка на страницу сайта на языке lang. Внутри своего языка — next/link; на страницу другой
 * корневой раскладки (например, с русской страницы на английскую документацию) — обычная <a>: такой
 * переход — полная загрузка страницы.
 */
export function PageLink({
  lang,
  path,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { lang: Lang; path: string }) {
  const target = href(lang, path);
  return langOf(target) === lang ? (
    <Link href={target} {...props} />
  ) : (
    <a href={target} hrefLang={langOf(target)} {...props} />
  );
}
