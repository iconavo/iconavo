import { SIDEBAR_SCRIPT } from "../lib/sidebar";
import { THEME_SCRIPT } from "../lib/theme";

/**
 * Скрипт в <head> корневой раскладки: ставит выбранную тему и свёрнутую боковую панель до первой
 * отрисовки (руководство Next.js «Preventing flash before hydration»). CSP разрешает встроенные скрипты
 * (lib/headers.ts).
 */
const html = { __html: THEME_SCRIPT + SIDEBAR_SCRIPT };

export function ThemeScript() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: постоянный скрипт сайта, без данных от пользователя: тема и панель — до отрисовки страницы
  return <script dangerouslySetInnerHTML={html} />;
}
