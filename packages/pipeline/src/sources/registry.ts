import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type SourceConfig, sourceConfigSchema } from "./config.js";

/**
 * Загружает все конфиги из папки `sources/`: по одному файлу `{id}.ts` на набор,
 * конфиг — экспорт по умолчанию. Файл с ошибкой в конфиге останавливает загрузку.
 */
export async function loadRegistry(dir: string): Promise<SourceConfig[]> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
  const configs: SourceConfig[] = [];
  for (const file of files) {
    const module = (await import(pathToFileURL(join(dir, file)).href)) as {
      default?: unknown;
    };
    const parsed = sourceConfigSchema.safeParse(module.default);
    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((i) => `  ${i.path.join(".") || "(конфиг)"} — ${i.message}`)
        .join("\n");
      throw new Error(`sources/${file}: ошибки в конфиге\n${problems}`);
    }
    const expected = file.replace(/\.ts$/, "");
    if (parsed.data.id !== expected) {
      throw new Error(
        `sources/${file}: id «${parsed.data.id}» должен совпадать с именем файла «${expected}»`,
      );
    }
    configs.push(parsed.data);
  }
  return configs;
}
