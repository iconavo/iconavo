// Адрес edge API для данных каталога (ADR-0024): свой — из NEXT_PUBLIC_ICONAVO_API (его задаёт только
// pnpm site --check: превью API этой ветки), иначе api.iconavo.dev. Тот же адрес берут сборка сайта и
// браузер: сетка набора догружает список имён сама. Next.js вписывает process.env.NEXT_PUBLIC_… в сборку;
// в Storybook (Vite) process может не быть.

function env(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export const API =
  env(() => process.env.NEXT_PUBLIC_ICONAVO_API) || "https://api.iconavo.dev";
