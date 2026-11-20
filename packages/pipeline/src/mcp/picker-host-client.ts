// Страница-хост сетки выбора (шаг 11 фазы 4, ADR-0045), скрипт браузера: та же связь, что у клиента MCP
// Apps, — AppBridge SDK в странице, вид — в рамке sandbox="allow-scripts" со строгой политикой
// спецификации (её ставит сервер заголовком у /view.html). Данные — сценарии из data/ (picker-fixtures.ts);
// что сетка отдала ассистенту, видно под рамкой. Собирается rolldown для браузера (bundleBrowser).

import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

interface Scenario {
  id: string;
  title: string;
  width: number;
  hostContext: {
    theme: "light" | "dark";
    locale: string;
    platform: "web" | "desktop" | "mobile";
    displayMode: "inline";
  };
  caps: {
    message?: Record<string, unknown>;
    updateModelContext?: Record<string, unknown>;
  };
  input: Record<string, unknown>;
  result: Record<string, unknown>;
}

const query = new URLSearchParams(location.search);
/** Задержка ответа после входа: виден «поиск» с местами под карточки. */
const delay = Number(query.get("delay") ?? 700);
/** Поломка контрольного запуска проверки — её подкладывает сервер страницы. */
const canary = query.get("canary");
const suffix =
  canary === null ? "" : `?${new URLSearchParams({ canary }).toString()}`;

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block: { type?: string; text?: string }) =>
      block?.type === "text" ? String(block.text) : `[${block?.type}]`,
    )
    .join("\n");
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Журнал сценария: что ушло ассистенту — для глаз и для проверки в браузерах. */
const sent: Record<string, { kind: string; text: string }[]> = {};
(window as unknown as { pickerLog: typeof sent }).pickerLog = sent;

async function mount(s: Scenario, list: HTMLElement): Promise<void> {
  const section = node("section", "scenario");
  section.id = s.id;
  const chat = node("div", `chat chat-${s.hostContext.theme}`);
  const frame = node("div", "frame");
  frame.style.width = `${s.width}px`;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.title = s.title;
  iframe.src = `/view.html${suffix}`;
  frame.append(iframe);
  chat.append(frame);
  const log = node("div", "log");
  const body = node(
    "pre",
    "log-body",
    "Пока ничего: выберите иконку и нажмите Select.",
  );
  log.append(node("h3", "log-title", "Что получил ассистент"), body);
  section.append(node("h2", "scenario-title", s.title), chat, log);
  list.append(section);

  const entries: { kind: string; text: string }[] = [];
  sent[s.id] = entries;
  const show = () => {
    body.textContent = entries.map((e) => `${e.kind}:\n${e.text}`).join("\n\n");
  };
  const bridge = new AppBridge(
    null,
    { name: "iconavo-picker-host", version: "1" },
    s.caps,
    {
      hostContext: {
        ...s.hostContext,
        containerDimensions: { maxHeight: 2000, width: s.width },
      },
    },
  );
  if (s.caps.updateModelContext !== undefined) {
    bridge.onupdatemodelcontext = async (params) => {
      entries.push({ kind: "Контекст модели", text: textOf(params.content) });
      show();
      return {};
    };
  }
  if (s.caps.message !== undefined) {
    bridge.onmessage = async (params) => {
      entries.push({ kind: "Сообщение в чат", text: textOf(params.content) });
      show();
      return {};
    };
  }
  bridge.onsizechange = ({ height }) => {
    if (typeof height === "number") {
      iframe.style.height = `${Math.ceil(height)}px`;
    }
  };
  bridge.oninitialized = () => {
    void (async () => {
      await bridge.sendToolInput({ arguments: s.input });
      await new Promise((resolve) => setTimeout(resolve, delay));
      await bridge.sendToolResult(s.result as never);
      section.dataset.ready = "";
    })();
  };
  const target = iframe.contentWindow;
  if (target === null) throw new Error("рамка без окна");
  await bridge.connect(new PostMessageTransport(target, target));
}

const list = document.getElementById("scenarios");
if (list === null) throw new Error("нет места для сценариев");
const scenarios = (await (
  await fetch(`/scenarios.json${suffix}`)
).json()) as Scenario[];
const only = query.get("only");
for (const s of scenarios) {
  if (only === null || only === s.id) await mount(s, list);
}
document.body.dataset.mounted = "";
