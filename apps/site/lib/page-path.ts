import { usePathname } from "next/navigation";

/**
 * Адрес страницы для разметки (ADR-0039). После сброса кэша по меткам Vercel собирает главную заново в
 * фоне под её внутренним именем: usePathname() на сервере отдаёт «/index», а в браузере — «/». Без
 * поправки переключатель языка на главной вёл на /ru/index (404), а поле поиска шапки появлялось в
 * серверном HTML и расходилось с браузером при гидратации (17 ноября 2026). Префикс index зарезервирован
 * (ADR-0037), поэтому «/index» — всегда главная.
 */
export const pagePath = (pathname: string): string =>
  pathname === "/index" ? "/" : pathname;

/** usePathname() с поправкой pagePath: компоненты сайта берут адрес страницы только так. */
export function usePagePath(): string {
  return pagePath(usePathname());
}
