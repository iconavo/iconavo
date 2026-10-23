import { describe, expect, it } from "vitest";
import {
  fakeFetch,
  integrityOf,
  makeTgz,
} from "../sources/tar-builder.testing.js";
import {
  integrityHex,
  type NpmVersionDoc,
  parsePackument,
  parseProvenance,
  registryClient,
} from "./registry.js";

const REGISTRY = "https://registry.npmjs.org";
const NAME = "@iconavo-ui/icons-demo";
const DOC_URL = `${REGISTRY}/@iconavo-ui%2Ficons-demo`;

const PACKUMENT = {
  name: NAME,
  "dist-tags": { latest: "1.0.0", next: "1.0.1" },
  versions: {
    "1.0.0": {
      version: "1.0.0",
      dist: {
        tarball: `${REGISTRY}/${NAME}/-/icons-demo-1.0.0.tgz`,
        integrity: "sha512-AA==",
      },
      iconavo: { set: "demo", setVersion: "aaaaaaaa", fingerprint: "f1" },
      _npmUser: { name: "someone" },
    },
    "1.0.1": {
      version: "1.0.1",
      dist: {
        tarball: `${REGISTRY}/${NAME}/-/icons-demo-1.0.1.tgz`,
        integrity: "sha512-BB==",
        attestations: {
          url: `${REGISTRY}/-/npm/v1/attestations/${NAME}@1.0.1`,
          provenance: { predicateType: "https://slsa.dev/provenance/v1" },
        },
      },
      iconavo: { set: "demo", setVersion: "bbbbbbbb", fingerprint: "f2" },
      _npmUser: {
        name: "GitHub Actions",
        trustedPublisher: { id: "github", oidcConfigId: "oidc:1" },
      },
    },
  },
  time: {
    created: "2026-10-23T00:00:00.000Z",
    modified: "2026-10-23T01:00:00.000Z",
    "1.0.0": "2026-10-23T00:00:00.000Z",
    "1.0.1": "2026-10-23T01:00:00.000Z",
  },
};

/** Ответ реестра с подписями версии: в конверте DSSE — заявление in-toto в base64. */
function attestations(
  statement: object,
  predicateType = "https://slsa.dev/provenance/v1",
) {
  return {
    attestations: [
      {
        predicateType:
          "https://github.com/npm/attestation/tree/main/specs/publish/v0.1",
        bundle: {
          dsseEnvelope: { payload: Buffer.from("{}").toString("base64") },
        },
      },
      {
        predicateType,
        bundle: {
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
          },
        },
      },
    ],
  };
}

const STATEMENT = {
  subject: [{ name: `pkg:npm/${NAME}@1.0.1`, digest: { sha512: "abc123" } }],
  predicate: {
    buildDefinition: {
      externalParameters: {
        workflow: {
          ref: "refs/heads/main",
          repository: "https://github.com/iconavo/iconavo",
          path: ".github/workflows/publish.yml",
        },
      },
      resolvedDependencies: [
        {
          uri: "git+https://github.com/iconavo/iconavo@refs/heads/main",
          digest: { gitCommit: "c0ffee" },
        },
      ],
    },
    runDetails: {
      metadata: {
        invocationId:
          "https://github.com/iconavo/iconavo/actions/runs/7/attempts/1",
      },
    },
  },
};

/** Очередь ответов: каждый запрос берёт следующий, адреса записываются. */
function queueFetch(replies: (() => Response)[]) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const next = replies.shift();
    if (!next) throw new Error("лишний запрос");
    return next();
  }) as typeof fetch;
  return { fetch: fn, urls };
}

const noSleep = async () => {};

describe("parsePackument", () => {
  it("теги, версии с отметкой iconavo и кем выложено; служебные записи time — не версии", () => {
    const p = parsePackument(PACKUMENT);
    expect(p.distTags).toEqual({ latest: "1.0.0", next: "1.0.1" });
    expect(p.versions.get("1.0.0")).toMatchObject({
      fingerprint: "f1",
      setVersion: "aaaaaaaa",
      trustedPublisher: undefined,
    });
    expect(p.versions.get("1.0.1")).toMatchObject({
      fingerprint: "f2",
      trustedPublisher: "github",
      attestationsUrl: `${REGISTRY}/-/npm/v1/attestations/${NAME}@1.0.1`,
      provenancePredicate: "https://slsa.dev/provenance/v1",
    });
    expect([...p.times.keys()]).toEqual(["1.0.0", "1.0.1"]);
  });
});

describe("parseProvenance", () => {
  it("репозиторий, workflow, ветка, коммит, SHA-512 архива и запуск", () => {
    expect(parseProvenance(attestations(STATEMENT))).toEqual({
      repository: "https://github.com/iconavo/iconavo",
      workflow: ".github/workflows/publish.yml",
      ref: "refs/heads/main",
      commit: "c0ffee",
      sha512: "abc123",
      run: "https://github.com/iconavo/iconavo/actions/runs/7/attempts/1",
    });
  });

  it("нет подписи SLSA или ответ не разобрать — undefined", () => {
    expect(parseProvenance(attestations(STATEMENT, "other"))).toBeUndefined();
    expect(parseProvenance({ nope: 1 })).toBeUndefined();
    expect(
      parseProvenance({
        attestations: [
          {
            predicateType: "https://slsa.dev/provenance/v1",
            bundle: { dsseEnvelope: { payload: "не base64 и не JSON" } },
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("integrity в base64 → hex, как в подписи", () => {
    expect(integrityHex("sha512-AAEC")).toBe("000102");
  });
});

describe("registryClient", () => {
  it("описание пакета: имя со scope кодируется, 404 — пакета нет", async () => {
    const { fetch, calls } = fakeFetch({ [DOC_URL]: PACKUMENT });
    const registry = registryClient({ fetch, sleep: noSleep });
    expect((await registry.packument(NAME))?.distTags.next).toBe("1.0.1");
    expect(calls).toEqual([DOC_URL]);
    expect(await registry.packument("@iconavo-ui/icons-none")).toBeUndefined();
  });

  it("временный отказ реестра повторяется", async () => {
    const sleeps: number[] = [];
    const { fetch, urls } = queueFetch([
      () => new Response("busy", { status: 503 }),
      () => Response.json(PACKUMENT),
    ]);
    const registry = registryClient({
      fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect((await registry.packument(NAME))?.name).toBe(NAME);
    expect(urls).toEqual([DOC_URL, DOC_URL]);
    expect(sleeps).toHaveLength(1);
  });

  it("архив версии: SHA-512 сходится — файлы без верхней папки, крупные тоже", async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0x61);
    const tgz = makeTgz([
      { name: "package/package.json", data: '{"name":"x"}' },
      { name: "package/icons.json", data: big },
    ]);
    const url = `${REGISTRY}/${NAME}/-/icons-demo-1.0.0.tgz`;
    const { fetch } = fakeFetch({ [url]: tgz });
    const registry = registryClient({ fetch, sleep: noSleep });
    const doc: NpmVersionDoc = {
      version: "1.0.0",
      tarball: url,
      integrity: integrityOf(tgz),
    };
    const files = await registry.files(doc);
    expect([...files.keys()]).toEqual(["icons.json", "package.json"]);
    expect(files.get("icons.json")?.byteLength).toBe(big.length);
  });

  it("SHA-512 не сходится — ошибка до распаковки", async () => {
    const tgz = makeTgz([{ name: "package/a.json", data: "{}" }]);
    const url = `${REGISTRY}/${NAME}/-/icons-demo-1.0.0.tgz`;
    const { fetch } = fakeFetch({ [url]: tgz });
    const registry = registryClient({ fetch, sleep: noSleep });
    await expect(
      registry.files({
        version: "1.0.0",
        tarball: url,
        integrity: integrityOf(Buffer.from("x")),
      }),
    ).rejects.toThrow("целостность архива 1.0.0 не совпала");
  });

  it("архив не из реестра — ошибка, запроса нет", async () => {
    const { fetch, calls } = fakeFetch({});
    const registry = registryClient({ fetch, sleep: noSleep });
    await expect(
      registry.files({
        version: "1.0.0",
        tarball: "https://evil.example.com/x.tgz",
        integrity: "sha512-AA==",
      }),
    ).rejects.toThrow("не из реестра");
    expect(calls).toEqual([]);
  });

  it("подпись версии: разбирается; нет адреса — undefined без запроса", async () => {
    const url = `${REGISTRY}/-/npm/v1/attestations/${NAME}@1.0.1`;
    const { fetch, calls } = fakeFetch({ [url]: attestations(STATEMENT) });
    const registry = registryClient({ fetch, sleep: noSleep });
    expect(
      await registry.provenance({
        version: "1.0.1",
        tarball: "",
        attestationsUrl: url,
      }),
    ).toMatchObject({ ref: "refs/heads/main" });
    expect(
      await registry.provenance({ version: "1.0.0", tarball: "" }),
    ).toBeUndefined();
    expect(calls).toEqual([url]);
  });
});
