// Проверка файла набора: pnpm validate <файл> [--kind icons|info|metadata|search|changelog]
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { FILE_KINDS, type FileKind, validate } from "./index.js";

const USAGE = `Использование: pnpm validate <файл> [--kind ${FILE_KINDS.join("|")}]
Вид файла определяется по имени (icons.json, info.json, metadata.json, search.json, changelog.json).`;

const args = process.argv.slice(2);
const kindFlag = args.indexOf("--kind");
let kindArg: string | undefined;
if (kindFlag !== -1) {
  kindArg = args[kindFlag + 1];
  args.splice(kindFlag, 2);
}
const file = args[0];

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

if (!file || args.length > 1) fail("Нужно указать один файл.");

const kind = (kindArg ?? basename(file, ".json")) as FileKind;
if (!FILE_KINDS.includes(kind)) {
  fail(`Не удалось определить вид файла «${kindArg ?? basename(file)}».`);
}

let data: unknown;
try {
  data = JSON.parse(await readFile(file, "utf8"));
} catch (e) {
  console.error(`${file}: не удалось прочитать JSON — ${(e as Error).message}`);
  process.exit(1);
}

const issues = validate(kind, data);
if (issues.length === 0) {
  console.log(`${file}: ошибок нет`);
} else {
  console.error(`${file}: ошибок — ${issues.length}`);
  for (const i of issues) console.error(`  ${i.path} — ${i.message}`);
  process.exit(1);
}
