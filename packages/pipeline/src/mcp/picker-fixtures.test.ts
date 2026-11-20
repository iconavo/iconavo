import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PICKER_META_KEY,
  parsePickerPayload,
} from "@iconavo-ui/snippets/picker";
import { describe, expect, it } from "vitest";
import { setSummary } from "../../../../apps/api/src/icon.js";
import { loadRegistry } from "../sources/registry.js";
import { readUsage } from "./build.js";
import {
  canonicalName,
  pickerScenarios,
  SCENARIOS,
  setSummaryOf,
} from "./picker-fixtures.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const DATA = join(ROOT, "data");

describe("данные сетки из data/", () => {
  it("набор, автор и лицензия — тем же правилом, что setSummary edge API", async () => {
    for (const prefix of ["lucide", "fluent-emoji-flat"]) {
      const info = JSON.parse(
        await readFile(join(DATA, prefix, "info.json"), "utf8"),
      );
      const metadata = JSON.parse(
        await readFile(join(DATA, prefix, "metadata.json"), "utf8"),
      );
      const credits = metadata.credits ?? [];
      expect(setSummaryOf(prefix, info, credits)).toEqual(
        setSummary(prefix, {
          collection: "000000000000",
          info,
          license: {},
          credits,
        }),
      );
    }
  });

  it("каноническое имя — по цепочке алиасов; нет имени или петля — undefined", () => {
    const set = {
      prefix: "demo",
      icons: { house: { body: "<path/>" } },
      aliases: {
        home: { parent: "house" },
        old: { parent: "home" },
        a: { parent: "b" },
        b: { parent: "a" },
      },
    };
    expect(canonicalName(set, "house")).toBe("house");
    expect(canonicalName(set, "old")).toBe("house");
    expect(canonicalName(set, "nope")).toBeUndefined();
    expect(canonicalName(set, "a")).toBeUndefined();
  });

  it("сценарии страницы просмотра: данные сетки по формату, 12 карточек с рисунками, кроме пустой выдачи", async () => {
    const configs = await loadRegistry(join(ROOT, "sources"));
    const scenarios = await pickerScenarios({
      configs,
      dataDir: DATA,
      install: (await readUsage(ROOT)).install,
    });
    expect(scenarios.map((s) => s.id)).toEqual(SCENARIOS.map((s) => s.id));
    for (const s of scenarios) {
      const payload = parsePickerPayload(s.result._meta[PICKER_META_KEY]);
      expect(payload, s.id).toBeDefined();
      const plan = SCENARIOS.find((p) => p.id === s.id);
      expect(payload?.cards.length, s.id).toBe(plan?.cards.length);
      for (const card of payload?.cards ?? []) {
        expect(payload?.icons[card.icon], `${s.id} ${card.icon}`).toBeDefined();
      }
    }
  }, 60_000);
});
