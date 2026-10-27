// Тег <iconavo-icon> (ADR-0032, ADR-0031): иконка по имени в открытом shadow DOM. Тег регистрирует
// первая копия пакета на странице, остальные пропускают регистрацию (customElements.get), а иконки,
// настройки и загрузку копии делят через общее хранилище ядра (ADR-0030). Класс создаётся внутри
// define: импорт пакета на сервере, где нет HTMLElement, ничего не ломает.
// - Сразу при подключении тег ставит резерв — пустой <svg> заданного размера, без размеров 1em: текст
//   рядом не прыгает, а скрипт, который вставил тег и тут же меряет, не увидит 0×0.
// - Иконка грузится, когда тег подходит к видимой части страницы: один IntersectionObserver на
//   страницу с запасом в полэкрана (решение владельца). С этого момента тег активен навсегда; с
//   noobserver и без IntersectionObserver — сразу. Тег, уже убранный со страницы, не активируется.
// - loadIcon — только при активации, смене имени и возвращении на страницу. Сигнал хранилища лишь
//   перерисовывает: иначе после «ошибки» запросы шли бы по кругу (ADR-0030).
// - Перерисовки копятся до микрозадачи, одной на страницу: исключение одного тега не мешает
//   остальным и не попадает в рассылку сигналов ядра.
// - Рисуется только новое: то же состояние с теми же атрибутами второй раз не рисуется, поэтому
//   резерв не пересоздаётся, пока иконка грузится, и отсчёт 150 мс до заглушки не начинается заново.
//   Заглушка — класс резерва (style.ts).
// - Подпись — у самого тега через ElementInternals, сразу, без ожидания видимости; внутренний <svg>
//   всегда скрыт от скринридеров, свои aria-* разработчика главнее. Атрибуты и содержимое страницы
//   внутри тега не трогаются: гидратация React не увидит чужого.
// - Цвет — свойством стиля внутреннего <svg> из скрипта: работают и var(--x), и строгая CSP.

import {
  getIcon,
  type IconData,
  loadIcon,
  renderIcon,
  SVG_NS,
  store,
  subscribeIcon,
  svgToString,
} from "@iconavo-ui/core/internal";
import { tagOptions } from "./options.js";
import { CSS } from "./style.js";
import { write } from "./trusted.js";

/** Имя тега (ADR-0029). */
export const TAG = "iconavo-icon";

/** Атрибуты, на смену которых тег отвечает; inline работает одним CSS. */
const ATTRIBUTES =
  "icon width height color stroke-width rotate flip label placeholder noobserver".split(
    " ",
  );

/** Запас наблюдателя: иконка грузится за полэкрана до появления (решение владельца, ADR-0032). */
const MARGIN = "50%";

/** Лист стилей; null — среда без них (например, jsdom в тестах разработчика). */
function sheet(): CSSStyleSheet | null {
  try {
    const value = new CSSStyleSheet();
    value.replaceSync(CSS);
    return value;
  } catch {
    return null;
  }
}

/**
 * Зарегистрировать тег, если его ещё нет. dev — режим разработки по умолчанию у этого входа пакета
 * (рамка у отсутствующей иконки); configure({ dev }) главнее.
 */
export function define(dev: boolean): void {
  if (typeof customElements === "undefined" || customElements.get(TAG)) {
    return;
  }

  class IconavoIcon extends HTMLElement {
    static observedAttributes = ATTRIBUTES;
    /** Наблюдатель видимости — один на страницу; null — его нет, теги активны сразу. */
    static #observer: IntersectionObserver | null | undefined;
    static #sheet: CSSStyleSheet | null | undefined;
    /** Теги, ждущие перерисовки в микрозадаче. */
    static #pending = new Set<IconavoIcon>();

    #root = this.attachShadow({ mode: "open" });
    #internals = this.attachInternals?.();
    /** Тег был у видимой части страницы: грузит и рисует иконку. */
    #active = false;
    /** Имя, на которое тег подписан, и отписка. */
    #name: string | null = null;
    #stop: (() => void) | undefined;
    /** Что нарисовано: данные иконки или класс резерва — и значения атрибутов. */
    #drawn: IconData | string | undefined;
    #key = "";

    constructor() {
      super();
      IconavoIcon.#sheet ??= sheet();
      if (IconavoIcon.#sheet) {
        this.#root.adoptedStyleSheets = [IconavoIcon.#sheet];
      }
    }

    connectedCallback(): void {
      if (!this.#active && !this.hasAttribute("noobserver")) {
        IconavoIcon.#observer ??= globalThis.IntersectionObserver
          ? new IntersectionObserver(
              (entries) => {
                for (const entry of entries) {
                  const tag = entry.target as IconavoIcon;
                  // Поздний сигнал о теге, которого уже нет на странице, ничего не делает.
                  if (entry.isIntersecting && tag.isConnected) {
                    tag.#active = true;
                    tag.#sync();
                  }
                }
              },
              { rootMargin: MARGIN },
            )
          : null;
        if (IconavoIcon.#observer) IconavoIcon.#observer.observe(this);
        else this.#active = true;
      }
      this.#sync();
    }

    disconnectedCallback(): void {
      IconavoIcon.#observer?.unobserve(this);
      IconavoIcon.#pending.delete(this);
      this.#subscribe(null);
    }

    /** Подписка на имя; null — отписка. */
    #subscribe(name: string | null): void {
      this.#stop?.();
      this.#stop = name
        ? subscribeIcon(name, () => this.#schedule())
        : undefined;
      this.#name = name;
    }

    attributeChangedCallback(name: string): void {
      if (name !== "label") {
        this.#schedule();
      } else if (this.#internals) {
        const label = this.getAttribute("label")?.trim() || null;
        this.#internals.role = label && "img";
        this.#internals.ariaLabel = label;
      }
    }

    #schedule(): void {
      const pending = IconavoIcon.#pending;
      if (pending.size === 0) {
        queueMicrotask(() => {
          for (const tag of pending) {
            pending.delete(tag);
            try {
              tag.#sync();
            } catch (e) {
              reportError(e);
            }
          }
        });
      }
      pending.add(this);
    }

    /** Подписка на имя из атрибута и рисунок — по атрибутам и состоянию на этот момент. */
    #sync(): void {
      if (!this.isConnected) return;
      if (this.hasAttribute("noobserver")) this.#active = true;
      if (this.#active) {
        IconavoIcon.#observer?.unobserve(this);
        const name = this.getAttribute("icon");
        if (name !== this.#name) {
          this.#subscribe(name);
          // Без имени — ни запроса, ни предупреждения: фреймворк может поставить его позже.
          if (name) loadIcon(name);
        }
      }
      this.#draw();
    }

    #draw(): void {
      const o = tagOptions((name) => this.getAttribute(name));
      const state =
        this.#active && this.#name ? getIcon(this.#name) : undefined;
      const missing = (store.settings.dev ?? dev) ? "missing" : "";
      const drawn =
        typeof state === "object"
          ? state
          : state === "loading"
            ? o.placeholder
            : state
              ? missing
              : "";
      if (drawn === this.#drawn && o.key === this.#key) return;
      this.#drawn = drawn;
      this.#key = o.key;
      if (typeof drawn === "object") {
        if (write(this.#root, svgToString(renderIcon(drawn, o.render)))) {
          const svg = this.#root.firstElementChild as SVGElement | null;
          if (svg && o.color) svg.style.color = o.color;
          return;
        }
      }
      // Резерв: до загрузки, «нет», «ошибка» и запрет Trusted Types — как отсутствующая иконка.
      const className = typeof drawn === "string" ? drawn : missing;
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("width", o.width);
      svg.setAttribute("height", o.height);
      svg.setAttribute("class", className);
      if (o.color) svg.style.color = o.color;
      this.#root.replaceChildren(svg);
    }
  }

  customElements.define(TAG, IconavoIcon);
}
