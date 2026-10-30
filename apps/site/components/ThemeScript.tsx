import { THEME_SCRIPT } from "../lib/theme";

/**
 * Скрипт темы в <head> корневой раскладки: ставит выбранную тему до первой отрисовки (руководство
 * Next.js «Preventing flash before hydration»). CSP разрешает встроенные скрипты (lib/headers.ts).
 */
export function ThemeScript() {
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: постоянный скрипт сайта, без данных от пользователя: тема — до отрисовки страницы
    <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
  );
}
