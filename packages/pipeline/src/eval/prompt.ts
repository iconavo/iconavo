// Промпт судьи эталона (шаг 12, ADR-0048): запрос, описание ожидаемой иконки и до 12 кандидатов —
// номер, имя файла автора без набора и PNG. Наших описаний и синонимов судья не видит, иначе эталон
// подыгрывал бы обогащению (ADR-0021). Ответ — JSON по схеме, ровно один вердикт на номер.

import { IMAGE_DETAIL, JUDGE_MODEL, REASONING_EFFORT } from "./config.js";
import { type GoldenQuery, VERDICTS, type Verdict } from "./golden.js";

export const JUDGE_INSTRUCTIONS = `Ты проверяешь выдачу поиска иконок для интерфейсов. Человек ввёл поисковый запрос и ждёт иконку, которую поставит в интерфейс, письмо или презентацию. Тебе показаны кандидаты: у каждого номер, имя файла от автора набора и картинка.

Для каждого кандидата реши, подходит ли он человеку с этим запросом:
- fits — подходит: показывает то, что описано в ожидании, или другой привычный образ того же понятия; эту иконку можно поставить по этому запросу.
- partial — частично: связан с запросом, но человек вряд ли выберет его — соседнее понятие, лишняя деталь меняет смысл, слишком общий или слишком частный образ.
- no — не подходит.

Не важно: стиль рисунка, толщина линий, контур или заливка, цвет, цветной эмодзи или строгий значок. Ожидание — пример образа, а не точный чертёж. Слова о назначении («для кнопки…», «для раздела…») объясняют, зачем иконка, и не требуют деталей на картинке. Имя файла помогает понять рисунок, но решает картинка.

Ответь только JSON вида {"verdicts":[{"n":1,"verdict":"fits"}]} — ровно один вердикт на каждый номер кандидата.`;

export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          verdict: { type: "string", enum: [...VERDICTS] },
        },
        required: ["n", "verdict"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
} as const;

export interface Candidate {
  n: number;
  /** Имя иконки без набора: `trash-2`. */
  name: string;
  png: Buffer;
}

const LANG_NAMES = { ru: "русский", en: "английский" } as const;

/** Текст перед картинками: инструкция, запрос и ожидание. */
export function promptText(query: GoldenQuery, count: number): string {
  return `${JUDGE_INSTRUCTIONS}

Запрос: «${query.query}» (язык: ${LANG_NAMES[query.lang]}).
Ожидание: ${query.description}
Кандидатов: ${count}.`;
}

/** Тело запроса к /chat/completions: одно сообщение пользователя — текст и картинки по номерам. */
export function judgeBody(
  query: GoldenQuery,
  candidates: readonly Candidate[],
): Record<string, unknown> {
  const content: unknown[] = [
    { type: "text", text: promptText(query, candidates.length) },
  ];
  for (const c of candidates) {
    content.push({ type: "text", text: `№${c.n}: ${c.name}` });
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${c.png.toString("base64")}`,
        detail: IMAGE_DETAIL,
      },
    });
  }
  return {
    model: JUDGE_MODEL,
    messages: [{ role: "user", content }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "verdicts", strict: true, schema: VERDICT_SCHEMA },
    },
    reasoning: { effort: REASONING_EFFORT },
  };
}

/** Номера кандидатов из текста запроса — для подменного судьи в тестах. */
export const candidateLines = (body: Record<string, unknown>) =>
  (
    ((body.messages as { content: unknown[] }[])[0]?.content ?? []) as {
      type: string;
      text?: string;
    }[]
  )
    .filter((p) => p.type === "text" && /^№\d+: /.test(p.text ?? ""))
    .map((p) => {
      const m = /^№(\d+): (.*)$/.exec(p.text ?? "");
      return { n: Number(m?.[1]), name: m?.[2] ?? "" };
    });

/**
 * Вердикты из ответа: JSON (можно в обёртке ```json), ровно один вердикт на каждый номер. Иначе —
 * ошибка с причиной, и эти пары размечаются снова.
 */
export function parseVerdicts(
  text: string,
  numbers: readonly number[],
): Map<number, Verdict> {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(clean);
  } catch {
    throw new Error(`ответ судьи не JSON: ${clean.slice(0, 120)}`);
  }
  const list = (json as { verdicts?: unknown })?.verdicts;
  if (!Array.isArray(list)) throw new Error("в ответе судьи нет verdicts");
  const wanted = new Set(numbers);
  const out = new Map<number, Verdict>();
  for (const item of list) {
    const n = (item as { n?: unknown })?.n;
    const verdict = (item as { verdict?: unknown })?.verdict;
    if (typeof n !== "number" || !wanted.has(n)) {
      throw new Error(`в ответе судьи номер «${String(n)}», которого не было`);
    }
    if (!(VERDICTS as readonly unknown[]).includes(verdict)) {
      throw new Error(`в ответе судьи вердикт «${String(verdict)}» для №${n}`);
    }
    if (out.has(n)) throw new Error(`в ответе судьи №${n} дважды`);
    out.set(n, verdict as Verdict);
  }
  if (out.size !== wanted.size) {
    throw new Error(
      `судья ответил про ${out.size} кандидатов из ${wanted.size}`,
    );
  }
  return out;
}
