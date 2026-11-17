import { describe, expect, it } from "vitest";
import { anchorIndex, anchorShift } from "./panel-anchor";

describe("опора прокрутки, пока открывается и закрывается панель", () => {
  const cards = [
    { top: -80, bottom: 20 },
    { top: 30, bottom: 130 },
    { top: 450, bottom: 550 },
    { top: 860, bottom: 960 },
  ];

  it("карточка иконки панели в окне — опора она", () => {
    expect(anchorIndex(cards, 2, 900)).toBe(2);
    // Видна хотя бы частью — тоже она.
    expect(anchorIndex(cards, 3, 900)).toBe(3);
  });

  it("её нет в окне или нет на странице — первая карточка, видная целиком", () => {
    expect(anchorIndex([{ top: -500, bottom: -400 }, ...cards], 0, 900)).toBe(
      2,
    );
    expect(anchorIndex(cards, -1, 900)).toBe(1);
  });

  it("ни одной карточки целиком — без опоры", () => {
    expect(anchorIndex([{ top: -80, bottom: 20 }], -1, 900)).toBe(-1);
    expect(anchorIndex([], -1, 900)).toBe(-1);
  });

  it("сдвиг страницы — на сколько уехала опора; меньше полупикселя — нисколько", () => {
    expect(anchorShift(450, 508)).toBe(58);
    expect(anchorShift(450, 342)).toBe(-108);
    expect(anchorShift(450, 450.4)).toBe(0);
  });
});
