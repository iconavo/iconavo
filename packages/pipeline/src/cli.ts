// Команды конвейера: pnpm sources fetch [id…] | pnpm sources pin <id> [версия|коммит]
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSource, pinEntry } from "./sources/fetch.js";
import { readLock, writeLock } from "./sources/lock.js";
import { loadRegistry } from "./sources/registry.js";
import { formatReport } from "./sources/report.js";

const USAGE = `Использование:
  pnpm sources fetch [id…]            скачать все наборы или указанные
  pnpm sources pin <id> [версия|коммит]   закрепить версию (по умолчанию последнюю)`;

// packages/pipeline/dist/cli.js -> корень репозитория
const root = fileURLToPath(new URL("../../../", import.meta.url));
const lockPath = join(root, "sources.lock.json");
const cacheDir = join(root, ".cache", "sources");

const [command, ...args] = process.argv.slice(2);

function usageError(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

try {
  const configs = await loadRegistry(join(root, "sources"));
  const pick = (ids: string[]) => {
    for (const id of ids) {
      if (!configs.some((c) => c.id === id)) {
        usageError(
          `Набор «${id}» не найден. Есть: ${configs.map((c) => c.id).join(", ")}.`,
        );
      }
    }
    return ids.length ? configs.filter((c) => ids.includes(c.id)) : configs;
  };

  if (command === "fetch") {
    let lock = await readLock(lockPath);
    let failed = 0;
    for (const config of pick(args)) {
      try {
        const result = await fetchSource(config, lock, { cacheDir });
        lock = result.lock;
        await writeLock(lockPath, lock); // сохраняем сразу: следующий набор может упасть
        console.log(`${formatReport(result.report)}\n`);
      } catch (e) {
        failed++;
        console.error(`${config.id}: ошибка — ${(e as Error).message}\n`);
      }
    }
    process.exit(failed > 0 ? 1 : 0);
  } else if (command === "pin") {
    const [id, requested, ...rest] = args;
    if (!id || rest.length > 0) usageError("Нужно указать набор.");
    const [config] = pick([id]);
    if (!config) usageError(`Набор «${id}» не найден.`);
    const lock = await readLock(lockPath);
    const entry = await pinEntry(config, requested);
    await writeLock(lockPath, { ...lock, [config.id]: entry });
    const value = entry.type === "npm" ? entry.version : entry.commit;
    console.log(
      `${config.id}: закреплено ${value}. Скачайте: pnpm sources fetch ${config.id}`,
    );
  } else {
    usageError(
      command ? `Неизвестная команда «${command}».` : "Нужна команда.",
    );
  }
} catch (e) {
  console.error(`Ошибка: ${(e as Error).message}`);
  process.exit(1);
}
