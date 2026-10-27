import { describe, expect, it, vi } from "vitest";
import { replaceIds } from "./ids.js";

const p = () => "p_";

describe("replaceIds", () => {
  it("ID и все виды ссылок на него: url(#…), href, xlink:href, кавычки обоих видов", () => {
    expect(
      replaceIds(
        '<defs><linearGradient id="g"/><clipPath id=\'c\'><path/></clipPath><mask id="m"/></defs>' +
          '<path fill="url(#g)" clip-path="url(\'#c\')" mask=\'url("#m")\' style="fill:url(#g)"/>' +
          '<use href="#c"/><use xlink:href="#g"/>',
        p,
      ),
    ).toBe(
      '<defs><linearGradient id="p_0"/><clipPath id=\'p_1\'><path/></clipPath><mask id="p_2"/></defs>' +
        '<path fill="url(#p_0)" clip-path="url(\'#p_1\')" mask=\'url("#p_2")\' style="fill:url(#p_0)"/>' +
        '<use href="#p_1"/><use xlink:href="#p_0"/>',
    );
  });

  it("без ID — тот же текст, и prefix не вызывается", () => {
    const prefix = vi.fn(p);
    const body = '<path fill="currentColor" d="M0 0h24v24H0z"/>';
    expect(replaceIds(body, prefix)).toBe(body);
    expect(prefix).not.toHaveBeenCalled();
  });

  it("один prefix на рисунок, номера — по порядку первого появления", () => {
    const prefix = vi.fn(p);
    expect(
      replaceIds(
        '<g id="b"/><g id="a"/><g id="b"/><path fill="url(#a)" stroke="url(#b)"/>',
        prefix,
      ),
    ).toBe(
      '<g id="p_0"/><g id="p_1"/><g id="p_0"/><path fill="url(#p_1)" stroke="url(#p_0)"/>',
    );
    expect(prefix).toHaveBeenCalledTimes(1);
  });

  it("ID — начало другого ID: каждый заменяется целиком", () => {
    expect(
      replaceIds(
        '<g id="a"/><g id="a-1"/><g id="a1"/><path fill="url(#a-1)" stroke="url(#a)" filter="url(#a1)"/>',
        p,
      ),
    ).toBe(
      '<g id="p_0"/><g id="p_1"/><g id="p_2"/><path fill="url(#p_1)" stroke="url(#p_0)" filter="url(#p_2)"/>',
    );
  });

  it("новый ID совпал со старым — не переписывается повторно", () => {
    expect(
      replaceIds(
        '<g id="a"/><g id="p_0"/><use href="#a"/><use href="#p_0"/>',
        p,
      ),
    ).toBe('<g id="p_0"/><g id="p_1"/><use href="#p_0"/><use href="#p_1"/>');
  });

  it("особые символы регулярных выражений в ID", () => {
    expect(replaceIds('<g id="a.b(c)*"/><path fill="url(#a.b(c)*)"/>', p)).toBe(
      '<g id="p_0"/><path fill="url(#p_0)"/>',
    );
  });

  it("время анимации SMIL: begin после кавычки, «;» и пробела", () => {
    expect(
      replaceIds(
        '<animate id="x" begin="0s"/><animate begin="x.end"/><set begin="0s; x.end+1s"/><set begin="1s;x.begin"/>',
        p,
      ),
    ).toBe(
      '<animate id="p_0" begin="0s"/><animate begin="p_0.end"/><set begin="0s; p_0.end+1s"/><set begin="1s;p_0.begin"/>',
    );
  });

  it("цвет #abc, класс и атрибут data-id с тем же текстом не трогаются", () => {
    expect(
      replaceIds(
        '<g id="abc" class="abc" data-id="abc"/><path fill="#abc" stroke="url(#abc)"/>',
        p,
      ),
    ).toBe(
      '<g id="p_0" class="abc" data-id="abc"/><path fill="#abc" stroke="url(#p_0)"/>',
    );
  });
});
