import { configure } from "@iconavo-ui/react";

// Хосты иконок сайта — свои, если заданы NEXT_PUBLIC_ICONAVO_API и NEXT_PUBLIC_ICONAVO_CDN: так их
// задаёт только проверка pnpm site --check (превью на этом компьютере). Модуль импортируют и layout, и
// клиентские компоненты: у серверной и браузерной сборки Next.js своё ядро, и каждому нужен configure.
// Next.js вписывает process.env.NEXT_PUBLIC_… в сборку сам; в Storybook (Vite) process может не быть.
function env(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

const api = env(() => process.env.NEXT_PUBLIC_ICONAVO_API);
const cdn = env(() => process.env.NEXT_PUBLIC_ICONAVO_CDN);
if (api && cdn) configure({ api: [api], cdn: [cdn] });
