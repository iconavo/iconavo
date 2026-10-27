// Помощники тестов тега: маленькая подделка DOM ровно под те API, которыми пользуется element.ts, —
// HTMLElement с сигналами атрибутов, customElements, shadow DOM (innerHTML, replaceChildren,
// adoptedStyleSheets, firstElementChild), ElementInternals (role, ariaLabel), createElementNS,
// IntersectionObserver, CSSStyleSheet, CSS.supports, trustedTypes и reportError. Тесты зовут колбэки
// в порядке браузера: конструктор, сигнал на каждый атрибут, затем connectedCallback. Поддельное время
// — setTimeout ядра; микрозадачи настоящие. В сборку пакета не входит: tsconfig исключает *.testing.ts.

import { vi } from "vitest";

/** Элемент <svg>: резерв из createElementNS или рисунок из innerHTML. */
export class FakeSvg {
  readonly attributes = new Map<string, string>();
  readonly style = { color: "" };
  constructor(readonly html?: string) {}
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

/** TrustedHTML подделки: строка, обёрнутая политикой. */
export class FakeTrusted {
  constructor(readonly html: string) {}
}

export class FakeRoot {
  adoptedStyleSheets: unknown[] = [];
  firstElementChild: FakeSvg | null = null;
  /** Всё, что писалось в innerHTML, по порядку. */
  readonly writes: unknown[] = [];
  /** Trusted Types включены: строка в innerHTML — исключение, как в браузере. */
  static enforced = false;
  set innerHTML(value: unknown) {
    if (FakeRoot.enforced && !(value instanceof FakeTrusted)) {
      throw new TypeError(
        "Failed to set the 'innerHTML' property on 'ShadowRoot': This document requires 'TrustedHTML' assignment.",
      );
    }
    this.writes.push(value);
    this.firstElementChild = new FakeSvg(
      value instanceof FakeTrusted ? value.html : String(value),
    );
  }
  replaceChildren(node: FakeSvg): void {
    this.firstElementChild = node;
  }
}

type Changed = (name: string, old: string | null, value: string | null) => void;

export class FakeElement {
  static observedAttributes?: string[];
  readonly #attributes = new Map<string, string>();
  isConnected = false;
  shadow: FakeRoot | undefined;
  readonly internals = {
    role: null as string | null,
    ariaLabel: null as string | null,
  };
  attachShadow(): FakeRoot {
    this.shadow = new FakeRoot();
    return this.shadow;
  }
  attachInternals() {
    return this.internals;
  }
  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.#attributes.has(name);
  }
  setAttribute(name: string, value: string): void {
    const old = this.getAttribute(name);
    this.#attributes.set(name, value);
    this.#changed(name, old, value);
  }
  removeAttribute(name: string): void {
    const old = this.getAttribute(name);
    this.#attributes.delete(name);
    this.#changed(name, old, null);
  }
  #changed(name: string, old: string | null, value: string | null): void {
    const observed = (this.constructor as typeof FakeElement)
      .observedAttributes;
    if (observed?.includes(name)) {
      (
        this as unknown as { attributeChangedCallback: Changed }
      ).attributeChangedCallback(name, old, value);
    }
  }
}

/** Тег с колбэками жизненного цикла — как его видит браузер. */
export type Tag = FakeElement & {
  connectedCallback(): void;
  disconnectedCallback(): void;
};

export class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets = new Set<FakeElement>();
  constructor(
    readonly callback: (
      entries: { target: FakeElement; isIntersecting: boolean }[],
    ) => void,
    readonly options: { rootMargin?: string },
  ) {
    FakeObserver.all.push(this);
  }
  observe(target: FakeElement): void {
    this.targets.add(target);
  }
  unobserve(target: FakeElement): void {
    this.targets.delete(target);
  }
}

class FakeSheet {
  text = "";
  replaceSync(text: string): void {
    this.text = text;
  }
}

export interface DomOptions {
  /** Нет IntersectionObserver — как в jsdom. */
  noObserver?: boolean;
  /** Есть trustedTypes: политика оборачивает разметку; throws — createPolicy бросает. */
  trustedTypes?: "ok" | "throws";
  /** Строка в innerHTML — исключение. */
  enforced?: boolean;
}

/** Поставить подделку DOM вместо глобальных объектов; снимает её vi.unstubAllGlobals. */
export function installDom(options: DomOptions = {}) {
  const registry = new Map<string, new () => Tag>();
  const define = vi.fn((name: string, element: new () => Tag) => {
    if (registry.has(name)) {
      throw new Error(`the name "${name}" has already been used`);
    }
    registry.set(name, element);
  });
  FakeObserver.all = [];
  FakeRoot.enforced = options.enforced ?? false;
  const createPolicy = vi.fn(
    (_name: string, rules: { createHTML(html: string): string }) => {
      if (options.trustedTypes === "throws") {
        throw new TypeError("Policy iconavo disallowed.");
      }
      return {
        createHTML: (html: string) => new FakeTrusted(rules.createHTML(html)),
      };
    },
  );
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("customElements", {
    get: (name: string) => registry.get(name),
    define,
  });
  vi.stubGlobal(
    "IntersectionObserver",
    options.noObserver ? undefined : FakeObserver,
  );
  vi.stubGlobal("CSSStyleSheet", FakeSheet);
  vi.stubGlobal("document", { createElementNS: () => new FakeSvg() });
  vi.stubGlobal("CSS", {
    supports: (_property: string, value: string) => !value.startsWith("bogus"),
  });
  vi.stubGlobal(
    "trustedTypes",
    options.trustedTypes ? { createPolicy } : undefined,
  );
  vi.stubGlobal("reportError", vi.fn());

  /** Новый тег с атрибутами: конструктор и сигнал на каждый атрибут, ещё не на странице. */
  const create = (attributes: Record<string, string> = {}): Tag => {
    const IconElement = registry.get("iconavo-icon");
    if (!IconElement) throw new Error("тег не зарегистрирован");
    const tag = new IconElement();
    for (const [name, value] of Object.entries(attributes)) {
      tag.setAttribute(name, value);
    }
    return tag;
  };
  const connect = (tag: Tag): Tag => {
    tag.isConnected = true;
    tag.connectedCallback();
    return tag;
  };
  const disconnect = (tag: Tag): void => {
    tag.isConnected = false;
    tag.disconnectedCallback();
  };
  /** Сигнал наблюдателя: тег подошёл к видимой части страницы. Приходит и о снятых с наблюдения. */
  const intersect = (tag: Tag, isIntersecting = true): void => {
    for (const observer of FakeObserver.all) {
      observer.callback([{ target: tag, isIntersecting }]);
    }
  };
  /** Что в shadow DOM: рисунок строкой или резерв — атрибуты по порядку записи и цвет. */
  const shadow = (tag: Tag): string => {
    const node = tag.shadow?.firstElementChild;
    if (!node) return "";
    const color = node.style.color ? ` style.color=${node.style.color}` : "";
    if (node.html !== undefined) return `${node.html}${color}`;
    const attributes = [...node.attributes]
      .map(([name, value]) => `${name}="${value}"`)
      .join(" ");
    return `<svg ${attributes}>${color}`;
  };
  return {
    define,
    createPolicy,
    create,
    connect,
    disconnect,
    intersect,
    shadow,
    observed: () => FakeObserver.all.flatMap((o) => [...o.targets]),
    margins: () => FakeObserver.all.map((o) => o.options.rootMargin),
  };
}

/** Дать отработать микрозадачам и очереди ядра (setTimeout 0): время стоит. */
export async function idle(): Promise<void> {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
}

/** Ответ, который приходит, когда тест скажет. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
