import type {
  BatchClient,
  BatchRequest,
  BatchResponse,
  BatchResult,
} from "./batch.js";

export interface FakeBatch {
  id: string;
  requests: BatchRequest[];
  polls: number;
}

export interface FakeBatchOptions {
  /** Результат для запроса; undefined — результата в пакете нет. */
  answer: (request: BatchRequest) => BatchResult | undefined;
  /** Сколько опросов пакет «в работе», прежде чем завершится. */
  inProgress?: number;
}

/**
 * Подменный клиент пакетов без сети: create запоминает запросы и выдаёт id, retrieve отвечает
 * «в работе» заданное число раз, затем «завершён», results отдаёт ответы по правилу теста.
 */
export function fakeBatchClient(options: FakeBatchOptions) {
  const batches = new Map<string, FakeBatch>();
  const calls = { create: 0, retrieve: 0, results: 0 };
  let n = 0;
  const notFound = () => Object.assign(new Error("not found"), { status: 404 });
  const client: BatchClient = {
    async create(requests) {
      calls.create++;
      const id = `msgbatch_${++n}`;
      batches.set(id, { id, requests: [...requests], polls: 0 });
      return { id };
    },
    async retrieve(id) {
      calls.retrieve++;
      const batch = batches.get(id);
      if (!batch) throw notFound();
      batch.polls++;
      const ended = batch.polls > (options.inProgress ?? 0);
      return {
        processing_status: ended ? "ended" : "in_progress",
        request_counts: {
          processing: ended ? 0 : batch.requests.length,
          succeeded: ended ? batch.requests.length : 0,
          errored: 0,
          canceled: 0,
          expired: 0,
        },
      };
    },
    async results(id) {
      calls.results++;
      const batch = batches.get(id);
      if (!batch) throw notFound();
      const out: BatchResponse[] = [];
      for (const request of batch.requests) {
        const result = options.answer(request);
        if (result) out.push({ custom_id: request.custom_id, result });
      }
      return (async function* () {
        yield* out;
      })();
    },
  };
  /** Пакет, отправленный «раньше»: для тестов продолжения по файлу состояния. */
  const seed = (id: string, customIds: readonly string[]) => {
    batches.set(id, {
      id,
      requests: customIds.map((custom_id) => ({
        custom_id,
        params: { model: "x", max_tokens: 1, messages: [] },
      })),
      polls: 0,
    });
  };
  return { client, batches, calls, seed };
}

/** Правильный ответ модели для иконки name. */
export function goodAnswer(name: string): BatchResult {
  const lang = (p: string) => ({
    description: `${p}: ${name}.`,
    synonyms: [`${p} a`, `${p} b`, `${p} c`, `${p} d`, `${p} e`, `${p} f`],
  });
  return {
    type: "succeeded",
    message: {
      content: [
        { type: "thinking" },
        {
          type: "text",
          text: JSON.stringify({ ru: lang("ru"), en: lang("en") }),
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 800, output_tokens: 400 },
    },
  };
}
