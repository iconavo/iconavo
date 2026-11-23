import { GRID_SCRIPT } from "../lib/grid-script";
import { SIDEBAR_SCRIPT } from "../lib/sidebar";
import { THEME_SCRIPT } from "../lib/theme";

/**
 * Скрипт в <head> корневой раскладки: ставит выбранную тему, свёрнутую боковую панель, вид сетки и размер
 * иконок в плитках (lib/grid-script.ts) до первой отрисовки (руководство Next.js «Preventing flash before hydration»). CSP разрешает встроенные скрипты
 * (lib/headers.ts).
 */
const html = { __html: THEME_SCRIPT + SIDEBAR_SCRIPT + GRID_SCRIPT };

export function ThemeScript() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: постоянный скрипт сайта, без данных от пользователя: тема, панель и вид сетки — до отрисовки страницы
  return <script dangerouslySetInnerHTML={html} />;
}
