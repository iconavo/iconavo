// Подмена fetch у сервера Next.js в проверке примеров (ADR-0050). Подключается к процессам Next.js через
// NODE_OPTIONS=--import и только в проверке — в самом примере её нет. Запросы к живым хостам иконок
// уходят в превью API (таблица — ICONAVO_STARTERS_HOSTS), каждый пишется в журнал ICONAVO_STARTERS_LOG.
// Наш хост без пары — отказ и строка «unmapped» в журнале: пример не сходит на живой адрес незаметно.
// Остальные адреса — как есть: next build сам спрашивает реестр npm о версиях.

import { appendFileSync } from "node:fs";
import { mapUrl } from "./origins.js";

const map = JSON.parse(process.env.ICONAVO_STARTERS_HOSTS ?? "{}") as Record<
  string,
  string
>;
const log = process.env.ICONAVO_STARTERS_LOG;

const write = (line: string) => {
  if (log) appendFileSync(log, `${line}\n`);
};

const original = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const target = mapUrl(url, map);
  if (target === undefined) return original(input, init);
  if (target === null) {
    write(`unmapped ${url}`);
    return Promise.reject(
      new TypeError(`starters check: no preview for ${new URL(url).origin}`),
    );
  }
  write(`${url} -> ${target}`);
  return original(
    typeof input === "string" || input instanceof URL
      ? target
      : new Request(target, input),
    init,
  );
};
