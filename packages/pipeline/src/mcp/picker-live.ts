// Сетка выбора на живом сервере (шаг 11 фазы 4, ADR-0045): после выкладки проверка в браузерах берёт
// страницу у живого MCP-сервера — ресурс по адресу из pick_icon — и его ответы pick_icon на запросы
// сценариев страницы просмотра. Пустой выдачи у живого поиска не бывает: он всегда находит ближайшие по
// смыслу, поэтому этот сценарий пропускается.

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { MCP_PATH } from "./config.js";
import {
  type PickerScenario,
  SCENARIOS,
  scenarioOf,
} from "./picker-fixtures.js";

const PICKER_PREFIX = "ui://picker/";

export async function liveScenarios(base: string): Promise<{
  page: { html: string; version: string };
  scenarios: PickerScenario[];
}> {
  const client = new Client({ name: "iconavo-picker-check", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}${MCP_PATH}`)),
  );
  try {
    const tools = await client.listTools();
    const pick = tools.tools.find((t) => t.name === "pick_icon");
    const uri = (pick?._meta?.ui as { resourceUri?: unknown } | undefined)
      ?.resourceUri;
    if (typeof uri !== "string" || !uri.startsWith(PICKER_PREFIX)) {
      throw new Error("у pick_icon нет адреса интерфейса ui://picker/…");
    }
    const read = await client.readResource({ uri });
    const content = read.contents[0] as { text?: unknown } | undefined;
    if (typeof content?.text !== "string") {
      throw new Error(`ресурс ${uri} без страницы`);
    }
    const scenarios: PickerScenario[] = [];
    for (const plan of SCENARIOS) {
      if (plan.cards.length === 0) continue;
      const result = await client.callTool({
        name: "pick_icon",
        arguments: {
          query: plan.query,
          format: plan.format,
          ...(plan.sets === undefined ? {} : { sets: plan.sets }),
        },
      });
      if (result.isError === true) {
        throw new Error(`pick_icon «${plan.query}» — ошибка инструмента`);
      }
      scenarios.push(
        scenarioOf(plan, {
          content: result.content as PickerScenario["result"]["content"],
          structuredContent: (result.structuredContent ?? {}) as Record<
            string,
            unknown
          >,
          _meta: (result._meta ?? {}) as Record<string, unknown>,
        }),
      );
    }
    return {
      page: { html: content.text, version: uri.slice(PICKER_PREFIX.length) },
      scenarios,
    };
  } finally {
    // Сбой закрытия соединения не заслоняет настоящую ошибку (ревизия фазы 5, И-22).
    await client.close().catch(() => {});
  }
}
