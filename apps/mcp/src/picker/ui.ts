// Разметка и поведение сетки выбора (ADR-0045): карточки, переключатель стиля, цвет и «Выбрать». Узлы —
// через DOM-API; разметка строкой — только у рисунков иконок: SVG собирает ядро (renderIcon) из данных
// ответа, и ID у каждой карточки свои. Стилей в атрибутах нет — классы и переменные CSS; хранилищ браузера
// нет: в рамке клиента без своего адреса они недоступны.

import { renderIcon, svgToString } from "@iconavo-ui/core/internal";
import {
  cardName,
  cardSet,
  PICKER_META_KEY,
  type PickerChoice,
  type PickerPayload,
  type PickerStyle,
  parsePickerPayload,
  pickerChoice,
  pickerHasColor,
  pickerStyles,
} from "@iconavo-ui/snippets/picker";
import { COLOR_START, parseColor } from "@iconavo-ui/snippets/settings";
import { type Lang, TEXTS } from "./i18n.js";
import {
  cardOf,
  type GridCell,
  initialState,
  isAvailable,
  moveTo,
  type PickerState,
  selectCard,
  setColor,
  setStyle,
  withPayload,
  withQuery,
} from "./state.js";

/** Ответ инструмента в том виде, как его передаёт клиент. */
export interface ToolResultLike {
  content?: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

export interface PickerHandlers {
  /** «Выбрать»: отдать выбор ассистенту; ответ — дошло ли сообщение. */
  pick: (choice: PickerChoice, lang: Lang) => Promise<"sent" | "tell">;
}

export interface PickerView {
  query(query: string): void;
  result(result: ToolResultLike): void;
  cancelled(): void;
  lang(lang: Lang): void;
}

/** Мест под карточки, пока ответа нет: столько же, сколько вариантов. */
const SKELETONS = 12;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

const bareOf = (name: string) => name.slice(name.indexOf(":") + 1);

interface CardNodes {
  button: HTMLButtonElement;
  svg: HTMLSpanElement;
  name: HTMLSpanElement;
  set: HTMLSpanElement;
}

export function mountPicker(
  root: HTMLElement,
  handlers: PickerHandlers,
): PickerView {
  let state: PickerState = initialState();
  let lang: Lang = "en";
  let built: PickerPayload | undefined;
  let builtLang: Lang | undefined;
  const cards = new Map<number, CardNodes>();
  const pills = new Map<PickerStyle, HTMLButtonElement>();

  const title = el("h1", "picker-title");
  const styleGroup = el("div", "style-switch");
  styleGroup.setAttribute("role", "group");
  const colorField = el("div", "color-field");
  const swatch = el("input", "color-swatch");
  swatch.type = "color";
  const hex = el("input", "color-hex");
  hex.type = "text";
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.autocomplete = "off";
  colorField.append(swatch, hex);
  const tools = el("div", "picker-tools");
  tools.append(styleGroup, colorField);
  const head = el("header", "picker-head");
  head.append(title, tools);
  const grid = el("div", "picker-grid");
  grid.setAttribute("role", "radiogroup");
  const image = el("img", "picker-image");
  image.alt = "";
  const info = el("p", "picker-info");
  const button = el("button", "picker-select");
  button.type = "button";
  const foot = el("footer", "picker-foot");
  foot.append(info, button);
  const status = el("p", "picker-status");
  status.setAttribute("role", "status");
  root.replaceChildren(head, grid, image, foot, status);

  const t = () => TEXTS[lang];

  function skeleton(): void {
    if (grid.dataset.skeleton !== undefined) return;
    const cells: HTMLDivElement[] = [];
    for (let i = 0; i < SKELETONS; i++) {
      const li = el("div", "picker-cell");
      li.append(el("span", "card card-skeleton"));
      cells.push(li);
    }
    grid.replaceChildren(...cells);
    grid.dataset.skeleton = "";
  }

  /** Карточки и кнопки стиля — заново только для нового ответа или языка. */
  function build(p: PickerPayload): void {
    delete grid.dataset.skeleton;
    cards.clear();
    const cells = p.cards.map((card) => {
      const li = el("div", "picker-cell");
      const b = el("button", "card");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.n = String(card.n);
      if (card.exact) b.dataset.exact = "";
      const num = el("span", "card-num");
      num.textContent = String(card.n);
      num.setAttribute("aria-hidden", "true");
      const svg = el("span", "card-svg");
      svg.setAttribute("aria-hidden", "true");
      const name = el("span", "card-name");
      const set = el("span", "card-set");
      b.append(num, svg, name, set);
      li.append(b);
      cards.set(card.n, { button: b, svg, name, set });
      return li;
    });
    grid.replaceChildren(...cells);
    pills.clear();
    const styles = pickerStyles(p);
    styleGroup.replaceChildren(
      ...styles.map((style) => {
        const pill = el("button", "pill");
        pill.type = "button";
        pill.dataset.style = style;
        pill.textContent = t().styles[style];
        pills.set(style, pill);
        return pill;
      }),
    );
    built = p;
    builtLang = lang;
  }

  function draw(p: PickerPayload, n: number, name: string): string {
    const icon = p.icons[name];
    return icon === undefined
      ? ""
      : svgToString(renderIcon(icon, { idPrefix: `p${n}_${name}` }));
  }

  /** Карточка, на которой стоит фокус по Tab: выбранная, иначе первая доступная. */
  function tabTarget(p: PickerPayload): number | undefined {
    if (state.selected !== undefined) return state.selected;
    return p.cards.find((card) => isAvailable(state, card))?.n;
  }

  function renderCards(p: PickerPayload): void {
    const focus = tabTarget(p);
    for (const card of p.cards) {
      const nodes = cards.get(card.n);
      if (nodes === undefined) continue;
      const name = cardName(p, card, state.style);
      const shown = name ?? card.icon;
      if (nodes.button.dataset.icon !== shown) {
        nodes.button.dataset.icon = shown;
        nodes.svg.innerHTML = draw(p, card.n, shown);
        nodes.name.textContent = bareOf(shown);
      }
      const set = cardSet(p, shown);
      nodes.set.textContent = set?.name ?? "";
      nodes.button.classList.toggle("mono", set !== undefined && !set.palette);
      const available = name !== undefined;
      if (available) nodes.button.removeAttribute("aria-disabled");
      else nodes.button.setAttribute("aria-disabled", "true");
      nodes.button.setAttribute(
        "aria-checked",
        String(state.selected === card.n),
      );
      nodes.button.tabIndex = focus === card.n ? 0 : -1;
      const style = state.style === "any" ? "" : t().styles[state.style];
      nodes.button.setAttribute(
        "aria-label",
        `${bareOf(shown)} — ${set?.name ?? ""}${available ? "" : `, ${t().missing(style)}`}`,
      );
    }
  }

  function renderTools(p: PickerPayload): void {
    const styles = pickerStyles(p);
    styleGroup.hidden = styles.length <= 2;
    styleGroup.setAttribute("aria-label", t().style);
    for (const [style, pill] of pills) {
      pill.setAttribute("aria-pressed", String(state.style === style));
    }
    colorField.hidden = !pickerHasColor(p);
    swatch.value = state.color ?? COLOR_START;
    swatch.setAttribute("aria-label", t().color);
    if (state.color === undefined) swatch.dataset.auto = "";
    else delete swatch.dataset.auto;
    if (document.activeElement !== hex) {
      hex.value =
        state.color === undefined ? "" : state.color.slice(1).toUpperCase();
    }
    hex.placeholder = t().colorAuto;
    hex.setAttribute("aria-label", t().colorHex);
    if (state.color === undefined) grid.style.removeProperty("--picker-color");
    else grid.style.setProperty("--picker-color", state.color);
  }

  function statusText(): string {
    switch (state.status) {
      case "empty":
        return t().empty(state.query);
      case "error":
        return state.error === undefined
          ? t().error
          : `${t().error} ${state.error}`;
      case "cancelled":
        return t().cancelled;
      case "fallback":
        return t().fallback;
      case "ready":
        return state.delivery === "sending"
          ? t().sending
          : state.delivery === "sent"
            ? t().sent
            : state.delivery === "tell" && state.told !== undefined
              ? t().tell(state.told)
              : "";
      default:
        return "";
    }
  }

  function render(): void {
    const p = state.payload;
    root.setAttribute("aria-busy", String(state.status === "waiting"));
    root.dataset.status = state.status;
    grid.setAttribute("aria-label", t().icons);
    const ready = state.status === "ready" && p !== undefined;
    if (state.status === "waiting") {
      title.textContent = state.query === "" ? "" : t().searching(state.query);
      skeleton();
    } else if (ready) {
      if (built !== p || builtLang !== lang) build(p);
      title.textContent = t().title(p.cards.length, p.query);
      renderTools(p);
      renderCards(p);
    } else {
      title.textContent = state.query;
    }
    tools.hidden = !ready;
    grid.hidden = !(ready || state.status === "waiting");
    foot.hidden = !ready;
    image.hidden = !(state.status === "fallback" && state.image !== undefined);
    if (!image.hidden && state.image !== undefined) image.src = state.image;
    const card =
      ready && state.selected !== undefined
        ? cardOf(state, state.selected)
        : undefined;
    const name =
      card === undefined || p === undefined
        ? undefined
        : cardName(p, card, state.style);
    const set =
      name === undefined || p === undefined ? undefined : cardSet(p, name);
    info.textContent =
      set === undefined
        ? t().hint
        : `${set.name} · ${set.license.title} · ${set.author.name}`;
    button.textContent = t().select;
    button.disabled =
      name === undefined ||
      state.delivery === "sending" ||
      state.delivery === "sent";
    status.textContent = statusText();
  }

  function update(next: PickerState): void {
    state = next;
    render();
  }

  function cells(p: PickerPayload): GridCell[] {
    return p.cards.map((card) => ({
      n: card.n,
      available: isAvailable(state, card),
    }));
  }

  const columns = (): number =>
    getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean)
      .length || 1;

  grid.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>(".card");
    const n = Number(target?.dataset.n);
    if (Number.isInteger(n)) update(selectCard(state, n));
  });

  grid.addEventListener("keydown", (event) => {
    const p = state.payload;
    const target = (event.target as Element).closest<HTMLElement>(".card");
    const from = Number(target?.dataset.n);
    if (p === undefined || !Number.isInteger(from)) return;
    const to = moveTo(cells(p), from, event.key, columns());
    if (to === undefined) {
      if (
        event.key.startsWith("Arrow") ||
        event.key === "Home" ||
        event.key === "End"
      ) {
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    update(selectCard(state, to));
    cards.get(to)?.button.focus();
  });

  styleGroup.addEventListener("click", (event) => {
    const pill = (event.target as Element).closest<HTMLElement>(".pill");
    const style = pill?.dataset.style as PickerStyle | undefined;
    if (style !== undefined) update(setStyle(state, style));
  });

  swatch.addEventListener("input", () => {
    update(setColor(state, parseColor(swatch.value)));
  });

  hex.addEventListener("input", () => {
    const value = hex.value.trim();
    if (value === "") update(setColor(state, undefined));
    else {
      const color = parseColor(value);
      if (color !== undefined) update(setColor(state, color));
    }
  });

  hex.addEventListener("blur", () => render());

  button.addEventListener("click", () => {
    const p = state.payload;
    const card =
      state.selected === undefined ? undefined : cardOf(state, state.selected);
    if (p === undefined || card === undefined) return;
    const choice = pickerChoice(p, card, state.style, state.color);
    if (choice === undefined) return;
    const sending = state;
    update({ ...state, delivery: "sending" });
    handlers
      .pick(choice, lang)
      .catch(() => "tell" as const)
      .then((delivery) => {
        // Пока сообщение уходило, человек мог выбрать другое: тогда итог прежнего выбора не показываем.
        if (
          state.selected !== sending.selected ||
          state.style !== sending.style
        ) {
          return;
        }
        update({
          ...state,
          delivery,
          ...(delivery === "tell" ? { told: choice.icon } : {}),
        });
      });
  });

  return {
    query(query) {
      update(withQuery(state, query));
    },
    result(result) {
      const payload = parsePickerPayload(result._meta?.[PICKER_META_KEY]);
      const png = result.content?.find(
        (c) => c.type === "image" && typeof c.data === "string",
      );
      const picture =
        png === undefined
          ? undefined
          : `data:${png.mimeType ?? "image/png"};base64,${png.data}`;
      if (result.isError === true) {
        const text = result.content?.find((c) => c.type === "text")?.text;
        update({
          ...state,
          status: "error",
          ...(text === undefined ? {} : { error: text }),
        });
      } else if (payload !== undefined) {
        update(withPayload(state, payload));
      } else if (picture !== undefined) {
        update({ ...state, status: "fallback", image: picture });
      } else {
        update({ ...state, status: "error" });
      }
    },
    cancelled() {
      if (state.status === "waiting") update({ ...state, status: "cancelled" });
    },
    lang(next) {
      if (next === lang) return;
      lang = next;
      render();
    },
  };
}
