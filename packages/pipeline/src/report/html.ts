// Общие части HTML-отчётов конвейера: экранирование, картинки data:, каркас страницы и стили.
// В отчётах нет скриптов: политика безопасности разрешает только встроенные стили и картинки data:.

export const CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

export const esc = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** SVG как адрес data: — в <img> и в CSS он не выполняет скриптов и ничего не загружает. */
export const svgDataUri = (svg: string | Uint8Array) =>
  `data:image/svg+xml;base64,${(typeof svg === "string" ? Buffer.from(svg, "utf8") : Buffer.from(svg)).toString("base64")}`;

export const percent = (part: number, total: number) =>
  `${(total === 0 ? 0 : (part / total) * 100).toFixed(1).replace(".", ",")}%`;

/** «в 1 иконке», «в 21 иконке», «в 5 иконках». */
export const inIcons = (n: number) =>
  `в ${n} ${n % 10 === 1 && n % 100 !== 11 ? "иконке" : "иконках"}`;

/** Цвета, шрифт, заголовки, таблицы — светлая и тёмная тема по настройке системы. */
export const BASE_STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1c1c1e; --muted: #6b6b70; --line: #dcdce0; --ok: #1a7f37; --stop: #c62828; --code: #f4f4f6; }
@media (prefers-color-scheme: dark) { :root { --bg: #141416; --fg: #ececf0; --muted: #9a9aa2; --line: #34343a; --ok: #4ac26b; --stop: #ff6b6b; --code: #1e1e22; } }
body { margin: 0 auto; max-width: 1100px; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 28px; margin: 0 0 8px; } h2 { margin-top: 40px; border-bottom: 1px solid var(--line); padding-bottom: 6px; } h3 { margin: 28px 0 8px; } h4 { margin: 16px 0 8px; }
.muted { color: var(--muted); font-weight: normal; font-size: 0.9em; } .ok { color: var(--ok); font-weight: 600; } .stop { color: var(--stop); font-weight: 600; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; display: block; overflow-x: auto; } th, td { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; } .num { text-align: right; font-variant-numeric: tabular-nums; }
ul { margin: 6px 0; padding-left: 20px; } pre { background: var(--code); border-radius: 8px; padding: 10px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
a { color: inherit; } nav { margin: 12px 0; }
`;

/** Страница отчёта целиком. Без отметок времени: одинаковый вход — одинаковый файл. */
export function htmlPage(title: string, style: string, body: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${BASE_STYLE}${style}</style>
</head>
<body>
${body}
</body>
</html>
`;
}
