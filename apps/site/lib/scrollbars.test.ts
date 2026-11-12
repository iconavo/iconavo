import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCROLLBAR_FADE_MS,
  SCROLLBAR_IDLE_MS,
  SCROLLING_ATTR,
  type ScrollElement,
  trackScrolling,
} from "./scrollbars";

// Поддельные документ и элементы: событие прокрутки слушатель документа получает с целью — элементом,
// а прокрутка страницы приходит с целью «документ».
class FakeElement implements ScrollElement {
  readonly attrs = new Map<string, string>();
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  get mark() {
    return this.getAttribute(SCROLLING_ATTR);
  }
}

function fakeDocument() {
  const listeners = new Set<(event: Event) => void>();
  const options: AddEventListenerOptions[] = [];
  const doc = {
    documentElement: new FakeElement(),
    addEventListener(
      _type: "scroll",
      listener: (event: Event) => void,
      o: AddEventListenerOptions,
    ) {
      listeners.add(listener);
      options.push(o);
    },
    removeEventListener(_type: "scroll", listener: (event: Event) => void) {
      listeners.delete(listener);
    },
  };
  const scroll = (target: unknown) => {
    for (const listener of listeners) listener({ target } as unknown as Event);
  };
  return { doc, scroll, listeners, options };
}

describe("полосы прокрутки видны только при прокрутке", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("прокрутили — on сразу, через 800 мс — off, ещё через 300 мс пометки нет", () => {
    const { doc, scroll } = fakeDocument();
    const panel = new FakeElement();
    trackScrolling(doc);
    scroll(panel);
    expect(panel.mark).toBe("on");
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS - 1);
    expect(panel.mark).toBe("on");
    vi.advanceTimersByTime(1);
    expect(panel.mark).toBe("off");
    vi.advanceTimersByTime(SCROLLBAR_FADE_MS);
    expect(panel.mark).toBeNull();
  });

  it("прокрутка страницы приходит на документ — пометка у <html>", () => {
    const { doc, scroll } = fakeDocument();
    trackScrolling(doc);
    scroll(doc);
    expect(doc.documentElement.mark).toBe("on");
  });

  it("пока прокручивают, отсчёт начинается заново; прокрутка во время угасания — снова on", () => {
    const { doc, scroll } = fakeDocument();
    const panel = new FakeElement();
    trackScrolling(doc);
    scroll(panel);
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS - 100);
    scroll(panel);
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS - 100);
    expect(panel.mark).toBe("on");
    vi.advanceTimersByTime(100);
    expect(panel.mark).toBe("off");
    vi.advanceTimersByTime(SCROLLBAR_FADE_MS - 100);
    scroll(panel);
    expect(panel.mark).toBe("on");
    vi.advanceTimersByTime(SCROLLBAR_FADE_MS);
    expect(panel.mark).toBe("on");
  });

  it("у каждого элемента свой отсчёт: прокрутка страницы не зажигает полосу панели", () => {
    const { doc, scroll } = fakeDocument();
    const panel = new FakeElement();
    trackScrolling(doc);
    scroll(panel);
    vi.advanceTimersByTime(500);
    scroll(doc);
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS - 500);
    expect(panel.mark).toBe("off");
    expect(doc.documentElement.mark).toBe("on");
  });

  it("слушатель — в перехвате и пассивный; цели без атрибутов пропускаются", () => {
    const { doc, scroll, options } = fakeDocument();
    trackScrolling(doc);
    expect(options).toEqual([{ capture: true, passive: true }]);
    expect(() => scroll({})).not.toThrow();
    expect(() => scroll(null)).not.toThrow();
  });

  it("отписка снимает слушатель, таймеры и пометки", () => {
    const { doc, scroll, listeners } = fakeDocument();
    const panel = new FakeElement();
    const stop = trackScrolling(doc);
    scroll(panel);
    stop();
    expect(listeners.size).toBe(0);
    expect(panel.mark).toBeNull();
    vi.advanceTimersByTime(SCROLLBAR_IDLE_MS + SCROLLBAR_FADE_MS);
    expect(panel.mark).toBeNull();
  });
});
