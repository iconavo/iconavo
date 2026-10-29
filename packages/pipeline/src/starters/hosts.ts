// Хосты иконок в браузере при проверке примеров (ADR-0050): правило Playwright отвечает за живые адреса
// ответом превью API, а скрипт тега с jsDelivr — файлом из архива этой ветки. Других https-запросов у
// примера быть не должно: они обрываются и попадают в строку «Сеть». route.continue не годится —
// https в http он не переписывает, поэтому ответ превью берёт Node и отдаёт странице сам.

import { setTimeout as sleep } from "node:timers/promises";
import type { Page } from "playwright";
import { isOurHost, mapUrl } from "./origins.js";

/** Что страница спрашивала у внешних адресов. */
export interface Traffic {
  /** Живые адреса иконок, за которые ответило превью. */
  icons: string[];
  /** Скрипт тега с jsDelivr. */
  scripts: string[];
  /** Остальное: наш хост без пары или чужой адрес — оборвано. */
  stray: string[];
}

export interface RouteOptions {
  /** Живой хост → превью (origins.ts); null — живые хосты как есть (--npm и ручной запуск). */
  map: Record<string, string> | null;
  /** Адрес скрипта тега и его содержимое; задержка — чтобы было видно, что место держит стиль. */
  script?: { url: string; body: Buffer; delayMs: number };
  /** Скрипт тега с настоящего jsDelivr (--npm): его адрес пропускается как есть. */
  liveScript?: string;
  /** Контрольный запуск: хосты иконок не отвечают. */
  refuse?: boolean;
}

/** Заголовки, которые относятся к пересылке, а не к содержимому: Node уже распаковал тело. */
const DROP = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

export async function routeHosts(
  page: Page,
  o: RouteOptions,
): Promise<Traffic> {
  const traffic: Traffic = { icons: [], scripts: [], stray: [] };
  await page.route(
    (url) => url.protocol === "https:",
    async (route) => {
      const url = route.request().url();
      if (o.script && url === o.script.url) {
        traffic.scripts.push(url);
        await sleep(o.script.delayMs);
        return route.fulfill({
          status: 200,
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "access-control-allow-origin": "*",
            "cross-origin-resource-policy": "cross-origin",
          },
          body: o.script.body,
        });
      }
      if (o.liveScript && url === o.liveScript) {
        traffic.scripts.push(url);
        return route.continue();
      }
      const ours = isOurHost(new URL(url).hostname);
      const target =
        o.map === null ? (ours ? url : undefined) : mapUrl(url, o.map);
      if (typeof target !== "string") {
        traffic.stray.push(url);
        return route.abort();
      }
      traffic.icons.push(url);
      if (o.refuse) return route.abort("connectionrefused");
      if (o.map === null) return route.continue();
      try {
        const response = await fetch(target);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          if (!DROP.has(name)) headers[name] = value;
        });
        return route.fulfill({
          status: response.status,
          headers,
          body: Buffer.from(await response.arrayBuffer()),
        });
      } catch {
        return route.abort("failed");
      }
    },
  );
  return traffic;
}
