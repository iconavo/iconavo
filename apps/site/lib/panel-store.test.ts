import { describe, expect, it } from "vitest";
import { createPanelStore } from "./panel-store";

// Боковые панели — рюкзак и настройки сетки — занимают одно место справа: открытой бывает только одна
// (решение владельца 23 ноября 2026, ADR-0054).

describe("боковые панели", () => {
  it("открытие одной закрывает другую и забывает её кнопку — фокус уходит в новую панель", () => {
    const bag = createPanelStore();
    const settings = createPanelStore();
    const bagButton = {} as HTMLElement;
    const settingsButton = {} as HTMLElement;
    let bagChanges = 0;
    bag.subscribe(() => bagChanges++);

    bag.set(true, bagButton);
    expect([bag.get(), settings.get()]).toEqual([true, false]);

    settings.set(true, settingsButton);
    expect([bag.get(), settings.get()]).toEqual([false, true]);
    expect(bagChanges).toBe(2);
    expect(bag.takeOpener()).toBeNull();

    settings.set(false);
    expect(settings.takeOpener()).toBe(settingsButton);
    expect(settings.takeOpener()).toBeNull();
  });

  it("повторное открытие ничего не меняет", () => {
    const panel = createPanelStore();
    let changes = 0;
    panel.subscribe(() => changes++);
    panel.set(true);
    panel.set(true);
    expect(changes).toBe(1);
  });
});
