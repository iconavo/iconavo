// Хосты иконок в проверке примеров (ADR-0050): примеры ходят к живым адресам — так их видит
// разработчик, — а проверка отвечает за них превью API этой ветки, без интернета. Общее для браузера
// (hosts.ts, правила Playwright) и сервера Next.js (preload.ts): модуль без зависимостей — его грузит
// процесс Next.js.

/** Живые хосты иконок по умолчанию (ADR-0030): API и три хоста статики. */
export const LIVE_ORIGINS = [
  "https://api.iconavo.dev",
  "https://cdn.iconavo.dev",
  "https://cdn2.iconavo.dev",
  "https://iconavo.b-cdn.net",
] as const;

/** Кто отвечает за живой хост: за API — превью, за статику — его /_static/. */
export function hostMap(api: string): Record<string, string> {
  return {
    "https://api.iconavo.dev": api,
    "https://cdn.iconavo.dev": `${api}/_static`,
    "https://cdn2.iconavo.dev": `${api}/_static`,
    "https://iconavo.b-cdn.net": `${api}/_static`,
  };
}

/** Наш ли хост: iconavo.dev, его поддомены и адрес зоны Bunny. */
export const isOurHost = (hostname: string) =>
  hostname === "iconavo.dev" ||
  hostname.endsWith(".iconavo.dev") ||
  hostname === "iconavo.b-cdn.net";

/**
 * Адрес превью вместо живого. Наш хост без пары в таблице — null: пример ушёл бы на живой адрес. Чужой
 * адрес — undefined: его решает тот, кто спрашивает.
 */
export function mapUrl(
  url: string,
  map: Record<string, string>,
): string | null | undefined {
  const parsed = new URL(url);
  const target = map[parsed.origin];
  if (target !== undefined)
    return `${target}${parsed.pathname}${parsed.search}`;
  return isOurHost(parsed.hostname) ? null : undefined;
}
