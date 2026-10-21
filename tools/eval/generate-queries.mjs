// Генерирует эталон поиска (ADR-0021): docs/eval/queries.csv.
// Запуск: node --env-file=.env tools/eval/generate-queries.mjs
// Ключ берётся только из POLZA_API_KEY и нигде не печатается.
import { writeFile } from "node:fs/promises";

const MODEL = "google/gemini-3.8-flash";
const ENDPOINT = "https://polza.ai/api/v1/chat/completions";
const OUT = new URL("../../docs/eval/queries.csv", import.meta.url);
const PER_CELL = 20;
const ASK = 26; // просим с запасом на дубликаты и брак
const MAX_ATTEMPTS = 3;
const MAX_QUERY_LENGTH = 60;
const SEED = "iconavo-eval-1";

const LANGS = {
  ru: "русском",
  en: "английском",
};

const TYPES = {
  object: "предметы: названия вещей и объектов (например, «часы», «чемодан»)",
  action: "действия: глаголы и команды (например, «скачать», «отправить»)",
  abstract:
    "абстракции: понятия без очевидной формы (например, «безопасность», «рост»)",
  ui: "интерфейсные термины: элементы и паттерны интерфейса (например, «бургер-меню», «переключатель»)",
  casual:
    "разговорные слова: как пишет обычный человек, неточно, сленгом или описанием (например, «галочка», «шестерёнка», «три точки»)",
};

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          expected_description: { type: "string" },
        },
        required: ["query", "expected_description"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

function prompt(lang, type, exclude) {
  return [
    "Ты помогаешь составить тестовый набор для поиска иконок в каталоге интерфейсных иконок.",
    `Придумай ${ASK} разных поисковых запросов на ${LANGS[lang]} языке, тип запросов — ${TYPES[type]}.`,
    "Запросы должны быть такими, как их вводят реальные люди в поле поиска, когда решают рабочую задачу: делают кнопку, меню, раздел настроек, письмо, презентацию, приложение. Исходи из сценариев задач, а не из списка существующих иконок.",
    "Запрос — 1–4 слова, без знаков препинания. Не называй наборы иконок и не пиши имена файлов.",
    "Для каждого запроса опиши словами, какую иконку ожидает увидеть человек: образ и форма, одним предложением, без привязки к набору. Описание пиши на русском.",
    "Запросы внутри ответа не должны повторяться и не должны быть вариантами одного слова.",
    exclude.length ? `Уже есть, не повторяй: ${exclude.join("; ")}.` : "",
    'Ответь только JSON вида {"items":[{"query":"…","expected_description":"…"}]}.',
  ]
    .filter(Boolean)
    .join("\n");
}

const key = process.env.POLZA_API_KEY;
if (!key) {
  console.error(
    "Нет POLZA_API_KEY. Запускай так: node --env-file=.env tools/eval/generate-queries.mjs",
  );
  process.exit(1);
}

async function chat(content) {
  const base = {
    model: MODEL,
    messages: [{ role: "user", content }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "queries", strict: true, schema: SCHEMA },
    },
    reasoning: { effort: "low" },
  };
  // Если сервер не принимает необязательное поле, повторяем без него.
  const variants = [
    base,
    { ...base, reasoning: undefined },
    { ...base, reasoning: undefined, response_format: undefined },
  ];
  let last = "";
  for (const body of variants) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const text = json.choices?.[0]?.message?.content;
      if (typeof text === "string") return text;
      last = "пустой ответ модели";
      continue;
    }
    last = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 400 && res.status !== 422) break;
  }
  throw new Error(last);
}

function parseItems(text) {
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const items = JSON.parse(clean).items;
  if (!Array.isArray(items)) throw new Error("в ответе нет items");
  return items;
}

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function cell(lang, type, seen) {
  const got = [];
  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS && got.length < PER_CELL;
    attempt++
  ) {
    const exclude = got.map((g) => g.query);
    try {
      for (const it of parseItems(await chat(prompt(lang, type, exclude)))) {
        const query = String(it.query ?? "").trim();
        const desc = String(it.expected_description ?? "").trim();
        const k = norm(query);
        if (!query || !desc || query.length > MAX_QUERY_LENGTH || seen.has(k))
          continue;
        seen.add(k);
        got.push({ query, expected_description: desc });
        if (got.length === PER_CELL) break;
      }
    } catch (e) {
      console.error(`  ${lang}/${type}, попытка ${attempt}: ${e.message}`);
    }
  }
  if (got.length < PER_CELL)
    throw new Error(`${lang}/${type}: получено ${got.length} из ${PER_CELL}`);
  return got;
}

function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (const c of seed)
    h = (Math.imul(h ^ c.charCodeAt(0), 3432918353) << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const csvCell = (v) =>
  /[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;

const rand = rng(SEED);
const seen = new Set();
const rows = [];
for (const lang of Object.keys(LANGS)) {
  let n = 0;
  for (const type of Object.keys(TYPES)) {
    console.log(`Генерирую ${lang}/${type}…`);
    const items = shuffle(await cell(lang, type, seen), rand);
    items.forEach((it, i) => {
      rows.push({
        id: `${lang}-${String(++n).padStart(3, "0")}`,
        ...it,
        lang,
        type,
        split: i < PER_CELL / 2 ? "work" : "holdout",
      });
    });
  }
}

const count = (f) => rows.filter(f).length;
if (
  rows.length !== 200 ||
  count((r) => r.lang === "ru") !== 100 ||
  count((r) => r.split === "work") !== 100
) {
  throw new Error("Нарушены инварианты эталона, файл не записан");
}

const cols = ["id", "query", "lang", "type", "expected_description", "split"];
const csv = [
  cols.join(","),
  ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")),
].join("\n");
await writeFile(OUT, `${csv}\n`, "utf8");
console.log(`Готово: ${rows.length} запросов → docs/eval/queries.csv`);
