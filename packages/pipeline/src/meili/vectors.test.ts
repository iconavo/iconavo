import { SEARCH_MODEL, STORE_KEYS, truncateUnit } from "@iconavo-ui/search";
import { describe, expect, it } from "vitest";
import { fakeStorage } from "../cdn/storage.testing.js";
import { readSetVectors, type SetVectors, writeSetVectors } from "./vectors.js";

const vector = (seed: number) =>
  truncateUnit(
    Array.from({ length: SEARCH_MODEL.dims }, (_, i) => Math.sin(seed + i)),
    SEARCH_MODEL.dims,
  );

const sample = (): SetVectors =>
  new Map([
    ["trash", { textHash: "0123456789abcdef", vector: vector(1) }],
    ["house", { textHash: "fedcba9876543210", vector: vector(2) }],
  ]);

describe("векторы иконок в бакете", () => {
  it("запись и чтение: векторы первыми, оглавление последним", async () => {
    const storage = fakeStorage();
    await writeSetVectors(storage.client, "lucide", sample());
    expect(storage.puts()).toEqual([
      STORE_KEYS.iconVectors("lucide"),
      STORE_KEYS.iconIndex("lucide"),
    ]);
    const read = await readSetVectors(storage.client, "lucide");
    expect(read.status).toBe("ok");
    expect([...read.vectors.keys()]).toEqual(["house", "trash"]);
    expect(read.vectors.get("trash")?.vector).toEqual(vector(1));
  });

  it("нет оглавления — missing; не сходится — broken", async () => {
    const storage = fakeStorage();
    expect((await readSetVectors(storage.client, "lucide")).status).toBe(
      "missing",
    );
    await writeSetVectors(storage.client, "lucide", sample());
    storage.seed(STORE_KEYS.iconVectors("lucide"), new Uint8Array(8));
    const read = await readSetVectors(storage.client, "lucide");
    expect(read).toMatchObject({ status: "broken" });
    expect(read.vectors.size).toBe(0);
  });

  it("другая модель в оглавлении — broken", async () => {
    const storage = fakeStorage();
    await writeSetVectors(storage.client, "lucide", sample());
    const index = JSON.parse(
      Buffer.from(
        storage.store.get(STORE_KEYS.iconIndex("lucide"))?.body ?? [],
      ).toString("utf8"),
    );
    storage.seed(
      STORE_KEYS.iconIndex("lucide"),
      JSON.stringify({ ...index, model: "other/model" }),
    );
    expect(await readSetVectors(storage.client, "lucide")).toMatchObject({
      status: "broken",
      reason: expect.stringMatching(/модель/),
    });
  });

  it("вектор не той длины не записывается", async () => {
    const storage = fakeStorage();
    await expect(
      writeSetVectors(
        storage.client,
        "lucide",
        new Map([
          ["x", { textHash: "0123456789abcdef", vector: new Float32Array(3) }],
        ]),
      ),
    ).rejects.toThrow(/вектор длины 3/);
  });
});
