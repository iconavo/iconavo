import { Inter_Tight } from "next/font/google";

/**
 * Шрифт сайта по макету (Figma «Iconavo — Макеты», переменная family/primary) — Inter Tight, лицензия
 * OFL. next/font скачивает файлы при сборке и отдаёт их с нашего домена: CSP пускает шрифты только
 * оттуда (font-src 'self'). Переменная --font-inter-tight — у <html>, токен --font-sans ссылается на неё.
 */
export const interTight = Inter_Tight({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter-tight",
  display: "swap",
});
