// Единственное место, где конвейер обращается к Claude API: пакеты Message Batches через
// официальный SDK (ADR-0046). Ключ приходит параметром и никуда не печатается.

import Anthropic from "@anthropic-ai/sdk";
import type { BatchClient } from "./batch.js";

export function anthropicBatchClient(apiKey: string): BatchClient {
  const client = new Anthropic({ apiKey });
  return {
    async create(requests) {
      const batch = await client.messages.batches.create({
        requests: [...requests],
      });
      return { id: batch.id };
    },
    retrieve: (id) => client.messages.batches.retrieve(id),
    results: (id) => client.messages.batches.results(id),
  };
}
