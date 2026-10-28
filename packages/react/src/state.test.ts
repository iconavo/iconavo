import { addIcons } from "@iconavo-ui/core";
import { describe, expect, it } from "vitest";
import { clientState, serverState } from "./state.js";

const DATA = { body: "<g/>", left: 0, top: 0, width: 16, height: 16 };

describe("сервер и гидратация — только данные обёртки", () => {
  it("иконка и «нет» обёртки — как есть; остальное верное — заглушка, неверное — «нет»", () => {
    expect(serverState("demo:a", DATA)).toBe(DATA);
    expect(serverState("demo:a", "missing")).toBe("missing");
    expect(serverState("demo:a", undefined)).toBe("loading");
    expect(serverState("Demo:A", undefined)).toBe("missing");
  });
});

describe("после гидратации — ядро, затем обёртка", () => {
  it("иконка ядра главнее обёртки: addIcons перерисовывает и иконки обёртки", () => {
    addIcons({ prefix: "state", icons: { core: { body: "<rect/>" } } });
    const state = clientState("state:core", DATA);
    expect(typeof state === "object" && state.body).toBe("<rect/>");
  });

  it("в ядре нет — иконка или «нет» обёртки, тот же объект; без обёртки — состояние ядра", () => {
    expect(clientState("state:fresh", DATA)).toBe(DATA);
    expect(clientState("state:fresh", "missing")).toBe("missing");
    expect(clientState("state:fresh", undefined)).toBe("loading");
    expect(clientState("Bad:Name", undefined)).toBe("missing");
  });
});
