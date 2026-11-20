// Разметка и поведение сетки выбора (ADR-0045). Решения владельца 20 ноября 2026 после проверки в Claude и
// ChatGPT: сверху вниз — 12 карточек, цвет и толщина линии, кнопки формата как в панели сайта (чего нет в
// продукте — «Soon»), строка с автором и лицензией и «Select». Без переключателя стиля, заголовка и
// подсказок; всё по-английски. Узлы — через DOM-API; разметка строкой — только у рисунков иконок: SVG
// собирает ядро (renderIcon) из данных ответа, ID у каждой карточки свои. Стилей в атрибутах нет —
// классы и переменные CSS; хранилищ браузера нет: в рамке клиента без своего адреса они недоступны.

import { renderIcon, svgToString } from "@iconavo-ui/core/internal";
import type { Format } from "@iconavo-ui/snippets/look";
import {
  cardHasStroke,
  cardSet,
  PICKER_FORMAT_GROUPS,
  PICKER_META_KEY,
  type PickerChoice,
  type PickerPayload,
  parsePickerPayload,
  pickerChoice,
  pickerHasColor,
} from "@iconavo-ui/snippets/picker";
import {
  COLOR_START,
  parseColor,
  STROKE_DEFAULT,
  STROKE_MAX,
  STROKE_MIN,
  STROKE_STEP,
} from "@iconavo-ui/snippets/settings";
import {
  cardOf,
  type GridCell,
  initialState,
  moveTo,
  type PickerState,
  selectCard,
  setColor,
  setFormat,
  setStroke,
  withPayload,
} from "./state.js";

/** Ответ инструмента в том виде, как его передаёт клиент. */
export interface ToolResultLike {
  content?: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

export interface PickerHandlers {
  /** «Select»: отдать выбор ассистенту. */
  pick: (choice: PickerChoice) => Promise<void>;
}

export interface PickerView {
  result(result: ToolResultLike): void;
  cancelled(): void;
}

/** Мест под карточки, пока ответа нет: столько же, сколько вариантов. */
const SKELETONS = 12;

const TEXT = {
  heading: "Pick an icon",
  icons: "Icons",
  color: "Color",
  colorHex: "Color, hex",
  colorAuto: "Auto",
  stroke: "Stroke width",
  soon: "Soon",
  select: "Select",
  selected: "Selected",
  sent: "Sent to the chat",
  empty: "No icons found. Ask the assistant to try other words.",
  error: "The picker could not show the icons.",
  cancelled: "The search was cancelled.",
  fallback: "Tell the assistant the number of the icon you like.",
};

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
}

export function mountPicker(
  root: HTMLElement,
  handlers: PickerHandlers,
): PickerView {
  let state: PickerState = initialState();
  let built: PickerPayload | undefined;
  const cards = new Map<number, CardNodes>();
  const pills = new Map<Format, HTMLButtonElement>();

  const heading = el("h1", "sr-only");
  heading.textContent = TEXT.heading;

  const grid = el("div", "picker-grid");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", TEXT.icons);

  // Цвет и толщина линии — как поля панели сайта.
  const colorField = el("div", "picker-field");
  const colorLabel = el("span", "picker-label");
  colorLabel.textContent = TEXT.color;
  const colorBox = el("div", "color-field");
  const swatch = el("input", "color-swatch");
  swatch.type = "color";
  swatch.setAttribute("aria-label", TEXT.color);
  const hex = el("input", "color-hex");
  hex.type = "text";
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.autocomplete = "off";
  hex.placeholder = TEXT.colorAuto;
  hex.setAttribute("aria-label", TEXT.colorHex);
  colorBox.append(swatch, hex);
  colorField.append(colorLabel, colorBox);

  const strokeField = el("div", "picker-field");
  const strokeId = "picker-stroke";
  const strokeLabel = el("label", "picker-label");
  strokeLabel.htmlFor = strokeId;
  strokeLabel.textContent = TEXT.stroke;
  const strokeBox = el("div", "stroke-field");
  const range = el("input", "stroke-range");
  range.type = "range";
  range.id = strokeId;
  range.min = String(STROKE_MIN);
  range.max = String(STROKE_MAX);
  range.step = String(STROKE_STEP);
  const strokeValue = el("span", "stroke-value");
  strokeValue.setAttribute("aria-hidden", "true");
  strokeBox.append(range, strokeValue);
  strokeField.append(strokeLabel, strokeBox);

  const controls = el("div", "picker-controls");
  controls.append(colorField, strokeField);

  // Кнопки формата: те же группы, что в панели сайта; чего нет — «Soon».
  const formats = el("div", "picker-formats");
  for (const group of PICKER_FORMAT_GROUPS) {
    const set = el("fieldset", "pill-group");
    const legend = el("legend", "picker-label");
    legend.textContent = group.label;
    const row = el("div", "pill-row");
    for (const option of group.options) {
      const pill = el("button", "pill");
      pill.type = "button";
      pill.textContent = option.label;
      if (option.format === undefined) {
        pill.setAttribute("aria-disabled", "true");
        pill.setAttribute("aria-label", `${option.label} — ${TEXT.soon}`);
        pill.dataset.tip = TEXT.soon;
      } else {
        pill.dataset.format = option.format;
        pills.set(option.format, pill);
      }
      row.append(pill);
    }
    set.append(legend, row);
    formats.append(set);
  }

  const image = el("img", "picker-image");
  image.alt = "";
  const note = el("p", "picker-note");
  const info = el("p", "picker-info");
  const button = el("button", "picker-select");
  button.type = "button";
  const foot = el("footer", "picker-foot");
  foot.append(info, button);
  const live = el("p", "sr-only");
  live.setAttribute("role", "status");
  root.replaceChildren(
    heading,
    grid,
    controls,
    formats,
    foot,
    image,
    note,
    live,
  );

  function skeleton(): void {
    if (grid.dataset.skeleton !== undefined) return;
    const cells: HTMLDivElement[] = [];
    for (let i = 0; i < SKELETONS; i++) {
      const cell = el("div", "picker-cell");
      cell.append(el("span", "card card-skeleton"));
      cells.push(cell);
    }
    grid.replaceChildren(...cells);
    grid.dataset.skeleton = "";
  }

  /** Карточки — заново только для нового ответа. */
  function build(p: PickerPayload): void {
    delete grid.dataset.skeleton;
    cards.clear();
    const cells = p.cards.map((card) => {
      const cell = el("div", "picker-cell");
      const b = el("button", "card");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.n = String(card.n);
      b.dataset.icon = card.icon;
      if (card.exact) b.dataset.exact = "";
      const set = cardSet(p, card.icon);
      b.classList.toggle("mono", set !== undefined && !set.palette);
      b.setAttribute("aria-label", `${bareOf(card.icon)} — ${set?.name ?? ""}`);
      const num = el("span", "card-num");
      num.textContent = String(card.n);
      num.setAttribute("aria-hidden", "true");
      const svg = el("span", "card-svg");
      svg.setAttribute("aria-hidden", "true");
      const name = el("span", "card-name");
      name.textContent = bareOf(card.icon);
      name.setAttribute("aria-hidden", "true");
      const setName = el("span", "card-set");
      setName.textContent = set?.name ?? "";
      setName.setAttribute("aria-hidden", "true");
      b.append(num, svg, name, setName);
      cell.append(b);
      cards.set(card.n, { button: b, svg });
      return cell;
    });
    grid.replaceChildren(...cells);
    built = p;
  }

  /** Рисунок карточки: толщина — только у линий, ID — свои у каждой карточки. */
  function draw(p: PickerPayload, n: number, name: string): string {
    const icon = p.icons[name];
    return icon === undefined
      ? ""
      : svgToString(
          renderIcon(icon, {
            idPrefix: `p${n}_${name}`,
            ...(state.stroke === undefined
              ? {}
              : { strokeWidth: state.stroke }),
          }),
        );
  }

  /** Карточка, на которой стоит фокус по Tab: выбранная, иначе первая. */
  const tabTarget = (p: PickerPayload) => state.selected ?? p.cards[0]?.n;

  function renderCards(p: PickerPayload): void {
    const focus = tabTarget(p);
    const stroke = state.stroke === undefined ? "" : String(state.stroke);
    for (const card of p.cards) {
      const nodes = cards.get(card.n);
      if (nodes === undefined) continue;
      if (nodes.svg.dataset.stroke !== stroke || !nodes.svg.hasChildNodes()) {
        nodes.svg.innerHTML = draw(p, card.n, card.icon);
        nodes.svg.dataset.stroke = stroke;
      }
      nodes.button.setAttribute(
        "aria-checked",
        String(state.selected === card.n),
      );
      nodes.button.tabIndex = focus === card.n ? 0 : -1;
    }
  }

  function renderControls(p: PickerPayload): void {
    colorField.hidden = !pickerHasColor(p);
    swatch.value = state.color ?? COLOR_START;
    if (state.color === undefined) swatch.dataset.auto = "";
    else delete swatch.dataset.auto;
    if (document.activeElement !== hex) {
      hex.value =
        state.color === undefined ? "" : state.color.slice(1).toUpperCase();
    }
    if (state.color === undefined) grid.style.removeProperty("--picker-color");
    else grid.style.setProperty("--picker-color", state.color);
    strokeField.hidden = !p.cards.some((card) => cardHasStroke(p, card));
    const stroke = state.stroke ?? STROKE_DEFAULT;
    range.value = String(stroke);
    strokeValue.textContent = `${stroke} px`;
    for (const [format, pill] of pills) {
      pill.setAttribute("aria-pressed", String(state.format === format));
    }
  }

  function noteText(): string {
    switch (state.status) {
      case "empty":
        return TEXT.empty;
      case "error":
        return state.error === undefined
          ? TEXT.error
          : `${TEXT.error} ${state.error}`;
      case "cancelled":
        return TEXT.cancelled;
      case "fallback":
        return TEXT.fallback;
      default:
        return "";
    }
  }

  function render(): void {
    const p = state.payload;
    root.setAttribute("aria-busy", String(state.status === "waiting"));
    root.dataset.status = state.status;
    const ready = state.status === "ready" && p !== undefined;
    if (state.status === "waiting") skeleton();
    else if (ready) {
      if (built !== p) build(p);
      renderControls(p);
      renderCards(p);
    }
    grid.hidden = !(ready || state.status === "waiting");
    controls.hidden = !ready;
    formats.hidden = !ready;
    foot.hidden = !ready;
    image.hidden = !(state.status === "fallback" && state.image !== undefined);
    if (!image.hidden && state.image !== undefined) image.src = state.image;
    const text = noteText();
    note.hidden = text === "";
    note.textContent = text;
    const card =
      ready && state.selected !== undefined
        ? cardOf(state, state.selected)
        : undefined;
    const set =
      card === undefined || p === undefined ? undefined : cardSet(p, card.icon);
    info.textContent =
      set === undefined
        ? ""
        : `${set.name} · ${set.license.title} · ${set.author.name}`;
    button.textContent =
      state.delivery === "sent" ? TEXT.selected : TEXT.select;
    button.disabled = card === undefined || state.delivery !== "idle";
    live.textContent = state.delivery === "sent" ? TEXT.sent : "";
  }

  function update(next: PickerState): void {
    state = next;
    render();
  }

  function cells(p: PickerPayload): GridCell[] {
    return p.cards.map((card) => ({ n: card.n, available: true }));
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

  formats.addEventListener("click", (event) => {
    const pill = (event.target as Element).closest<HTMLElement>(".pill");
    const format = pill?.dataset.format as Format | undefined;
    if (format !== undefined) update(setFormat(state, format));
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

  range.addEventListener("input", () => {
    const value = Number(range.value);
    update(setStroke(state, Number.isFinite(value) ? value : undefined));
  });

  button.addEventListener("click", () => {
    const p = state.payload;
    const card =
      state.selected === undefined ? undefined : cardOf(state, state.selected);
    if (p === undefined || card === undefined) return;
    const choice = pickerChoice(p, card, {
      format: state.format,
      color: state.color,
      stroke: state.stroke,
    });
    if (choice === undefined) return;
    const sending = state;
    update({ ...state, delivery: "sending" });
    // Итог отправки — «Selected» при любом ответе клиента: Claude, например, кладёт сообщение в поле
    // ввода и отвечает ошибкой, хотя сообщение на месте. Пока сообщение уходило, человек мог поменять
    // выбор — тогда итог прежнего не показываем.
    handlers
      .pick(choice)
      .catch(() => undefined)
      .then(() => {
        if (
          state.selected !== sending.selected ||
          state.format !== sending.format ||
          state.color !== sending.color ||
          state.stroke !== sending.stroke
        ) {
          return;
        }
        update({ ...state, delivery: "sent" });
      });
  });

  return {
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
  };
}
