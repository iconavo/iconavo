import { describe, expect, it } from "vitest";
import {
  amzDate,
  canonicalPath,
  canonicalQuery,
  EMPTY_SHA256,
  sha256Hex,
  signRequest,
  uriEncode,
} from "./sigv4.js";

// Официальный набор проверок AWS Signature V4 (копия в botocore, tests/unit/auth/aws4_testsuite):
// ключи AKIDEXAMPLE / wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY, регион us-east-1, сервис service,
// время 20150830T123600Z. Ожидаемые строки взяты из файлов .creq, .sts и .authz каждого примера.
const SUITE = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "service",
  host: "example.amazonaws.com",
  date: new Date("2015-08-30T12:36:00Z"),
};
const HEADERS = "host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n";
const STS_HEAD =
  "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n";
const authz = (signed: string, signature: string) =>
  `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=${signed}, Signature=${signature}`;
const UNRESERVED =
  "-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const CASES = [
  {
    name: "get-vanilla",
    method: "GET",
    path: "/",
    creq: `GET\n/\n\n${HEADERS}\nhost;x-amz-date\n${EMPTY_SHA256}`,
    hash: "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
    signed: "host;x-amz-date",
    signature:
      "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  },
  {
    name: "get-vanilla-query-order-key-case",
    method: "GET",
    path: "/",
    query: [
      ["Param2", "value2"],
      ["Param1", "value1"],
    ] as const,
    creq: `GET\n/\nParam1=value1&Param2=value2\n${HEADERS}\nhost;x-amz-date\n${EMPTY_SHA256}`,
    hash: "816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0",
    signed: "host;x-amz-date",
    signature:
      "b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
  },
  {
    name: "get-utf8",
    method: "GET",
    path: "/ሴ",
    creq: `GET\n/%E1%88%B4\n\n${HEADERS}\nhost;x-amz-date\n${EMPTY_SHA256}`,
    hash: "2a0a97d02205e45ce2e994789806b19270cfbbb0921b278ccf58f5249ac42102",
    signed: "host;x-amz-date",
    signature:
      "8318018e0b0f223aa2bbf98705b62bb787dc9c0e678f255a891fd03141be5d85",
  },
  {
    name: "get-vanilla-query-unreserved",
    method: "GET",
    path: "/",
    query: [[UNRESERVED, UNRESERVED]] as const,
    creq: `GET\n/\n${UNRESERVED}=${UNRESERVED}\n${HEADERS}\nhost;x-amz-date\n${EMPTY_SHA256}`,
    hash: "c30d4703d9f799439be92736156d47ccfb2d879ddf56f5befa6d1d6aab979177",
    signed: "host;x-amz-date",
    signature:
      "9c3e54bfcdf0b19771a7f523ee5669cdf59bc7cc0884027167c21bb143a40197",
  },
  {
    name: "post-vanilla-query",
    method: "POST",
    path: "/",
    query: [["Param1", "value1"]] as const,
    creq: `POST\n/\nParam1=value1\n${HEADERS}\nhost;x-amz-date\n${EMPTY_SHA256}`,
    hash: "9d659678c1756bb3113e2ce898845a0a79dbbc57b740555917687f1b3340fbbd",
    signed: "host;x-amz-date",
    signature:
      "28038455d6de14eafc1f9222cf5aa6f1a96197d7deb8263271d420d138af7f11",
  },
  {
    name: "post-x-www-form-urlencoded",
    method: "POST",
    path: "/",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "Param1=value1",
    creq: `POST\n/\n\ncontent-type:application/x-www-form-urlencoded\n${HEADERS}\ncontent-type;host;x-amz-date\n9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e`,
    hash: "42a5e5bb34198acb3e84da4f085bb7927f2bc277ca766e6d19c73c2154021281",
    signed: "content-type;host;x-amz-date",
    signature:
      "ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a",
  },
];

describe("signRequest — официальные примеры Amazon", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const payloadHash =
        c.body === undefined ? EMPTY_SHA256 : sha256Hex(c.body);
      const signed = signRequest({
        ...SUITE,
        method: c.method,
        path: c.path,
        query: c.query,
        headers: c.headers,
        payloadHash,
      });
      expect(signed.canonicalRequest).toBe(c.creq);
      expect(signed.stringToSign).toBe(`${STS_HEAD}${c.hash}`);
      expect(signed.signature).toBe(c.signature);
      expect(signed.headers.authorization).toBe(authz(c.signed, c.signature));
      expect(signed.headers["x-amz-date"]).toBe("20150830T123600Z");
      expect(signed.headers.host).toBeUndefined();
    });
  }

  it("адрес запроса — канонический путь и запрос", () => {
    const signed = signRequest({
      ...SUITE,
      method: "GET",
      path: "/iconavo-cdn",
      query: [
        ["prefix", "v/ab/ph"],
        ["list-type", "2"],
        ["continuation-token", "ab+/="],
      ],
      payloadHash: EMPTY_SHA256,
    });
    expect(signed.target).toBe(
      "/iconavo-cdn?continuation-token=ab%2B%2F%3D&list-type=2&prefix=v%2Fab%2Fph",
    );
    expect(
      signRequest({
        ...SUITE,
        method: "PUT",
        path: "/iconavo-cdn/v/ab/ph/a.json",
        payloadHash: EMPTY_SHA256,
      }).target,
    ).toBe("/iconavo-cdn/v/ab/ph/a.json");
  });
});

describe("кодирование", () => {
  it("uriEncode — RFC 3986: дожимает !'()* и пробел", () => {
    expect(uriEncode("a b!*'()~-_.")).toBe("a%20b%21%2A%27%28%29~-_.");
    expect(uriEncode("v/ab")).toBe("v%2Fab");
  });
  it("canonicalPath — сегменты отдельно, «/» на месте", () => {
    expect(canonicalPath("/iconavo-cdn/v/ab/ph/a b.json")).toBe(
      "/iconavo-cdn/v/ab/ph/a%20b.json",
    );
  });
  it("canonicalQuery — порядок по именам, затем по значениям", () => {
    expect(
      canonicalQuery([
        ["b", "2"],
        ["a", "z"],
        ["a", "x"],
        ["c", ""],
      ]),
    ).toBe("a=x&a=z&b=2&c=");
  });
  it("amzDate — без разделителей и миллисекунд", () => {
    expect(amzDate(new Date("2026-10-22T07:16:03.123Z"))).toBe(
      "20261022T071603Z",
    );
  });
  it("sha256Hex — пустая строка даёт известный хэш", () => {
    expect(sha256Hex("")).toBe(EMPTY_SHA256);
    expect(sha256Hex(new Uint8Array())).toBe(EMPTY_SHA256);
  });
});
