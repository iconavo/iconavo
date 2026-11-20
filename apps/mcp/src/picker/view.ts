// Сетка выбора иконки в чате (шаг 11 фазы 4, ADR-0045): вид MCP Apps. Клиент показывает эту страницу в
// защищённой рамке и передаёт ей вход и ответ инструмента pick_icon. «Выбрать» отдаёт выбор ассистенту —
// тихо в контекст модели и коротким сообщением в чат (решение владельца 20 ноября 2026). Тема и язык — как
// у чата, шрифт — шрифт чата; переменные оформления чата не берём: их имена совпадают с токенами сайта.

// Первым: zod внутри SDK берёт настройку «без eval» при своей загрузке.
import "./jitless.js";
import { pickerContext, pickerMessage } from "@iconavo-ui/snippets/picker";
import {
  App,
  applyHostFonts,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { langOf } from "./i18n.js";
import { mountPicker } from "./ui.js";

/** Сколько ждать ответа на запрос, о поддержке которого клиент не сказал. */
const UNDECLARED_TIMEOUT_MS = 5_000;

const root = document.getElementById("picker");
if (root === null) throw new Error("нет места для сетки");

const app = new App(
  { name: "iconavo-picker", version: "1" },
  {},
  { autoResize: true },
);

const view = mountPicker(root, {
  async pick(choice, lang) {
    const caps = app.getHostCapabilities();
    const quick = (declared: unknown) =>
      declared === undefined ? { timeout: UNDECLARED_TIMEOUT_MS } : {};
    let delivered = false;
    try {
      await app.updateModelContext(
        pickerContext(choice),
        quick(caps?.updateModelContext),
      );
      delivered = true;
    } catch {
      delivered = false;
    }
    try {
      const result = await app.sendMessage(
        {
          role: "user",
          content: [
            { type: "text", text: pickerMessage(choice, lang, delivered) },
          ],
        },
        quick(caps?.message),
      );
      return result.isError === true ? "tell" : "sent";
    } catch {
      return "tell";
    }
  },
});

let fonts = "";

function applyContext(ctx: McpUiHostContext | undefined): void {
  if (ctx === undefined) return;
  const html = document.documentElement;
  if (ctx.theme === "light" || ctx.theme === "dark") {
    html.dataset.theme = ctx.theme;
  }
  if (ctx.locale !== undefined) {
    const lang = langOf(ctx.locale);
    html.lang = lang;
    view.lang(lang);
  }
  const font = ctx.styles?.variables?.["--font-sans"];
  if (typeof font === "string" && font.trim() !== "") {
    html.style.setProperty("--font-sans", font);
  }
  const css = ctx.styles?.css?.fonts;
  if (typeof css === "string" && css !== fonts) {
    fonts = css;
    applyHostFonts(css);
  }
  const inset = ctx.safeAreaInsets;
  if (inset !== undefined) {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      html.style.setProperty(`--safe-${side}`, `${inset[side]}px`);
    }
  }
}

app.addEventListener("toolinput", (params) => {
  const query = params.arguments?.query;
  if (typeof query === "string") view.query(query);
});
app.addEventListener("toolresult", (result) => view.result(result));
app.addEventListener("toolcancelled", () => view.cancelled());
app.addEventListener("hostcontextchanged", () =>
  applyContext(app.getHostContext()),
);
app.onteardown = async () => ({});

await app.connect();
applyContext(app.getHostContext());
