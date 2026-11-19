import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installCommand } from "./install.js";
import { installFromReadme, usageFromReadme } from "./readme.js";

const root = join(import.meta.dirname, "..", "..", "..");
const readme = readFileSync(
  join(root, "packages", "icon", "README.md"),
  "utf8",
);

describe("строки установки из README тега (шаг 5 фазы 4)", () => {
  it("настоящий README: скрипт с хэшем и стиль, пакеты без тега, подключение", () => {
    const install = installFromReadme(readme);
    const [script, style, ...rest] = install.script.split("\n");
    expect(rest).toEqual([]);
    expect(script).toMatch(
      /^<script type="module" src="https:\/\/cdn\.jsdelivr\.net\/npm\/@iconavo-ui\/icon@\d+\.\d+\.\d+\/dist\/iconavo-icon\.js" integrity="sha384-[A-Za-z0-9+/]{64}"><\/script>$/,
    );
    expect(style).toBe(
      "<style>iconavo-icon:not(:defined) { display: inline-block; width: 1em; height: 1em; }</style>",
    );
    expect(install.tag).toEqual({
      package: "@iconavo-ui/icon",
      import: 'import "@iconavo-ui/icon"; // registers <iconavo-icon>',
    });
    expect(install.react).toEqual({
      package: "@iconavo-ui/react",
      import: 'import { Icon } from "@iconavo-ui/react";',
    });
  });

  it("команда с тегом @next, разные хэши, нет строки — СТОП с подсказкой", () => {
    expect(() =>
      installFromReadme(
        readme.replace(
          "npm install @iconavo-ui/icon\n",
          "npm install @iconavo-ui/icon@next\n",
        ),
      ),
    ).toThrow(/npm install @iconavo-ui\/icon/);
    expect(() =>
      installFromReadme(
        readme.replace(/integrity="sha384-[^"]+"/, 'integrity="sha384-other"'),
      ),
    ).toThrow(/разные/);
    expect(() =>
      installFromReadme(readme.replaceAll(/<style>iconavo-icon[^\n]*/g, "")),
    ).toThrow(/<style>.* — нет/);
  });

  it("команды npm, pnpm и yarn — без тега версии", () => {
    expect(installCommand("npm", "@iconavo-ui/icon")).toBe(
      "npm install @iconavo-ui/icon",
    );
    expect(installCommand("pnpm", "@iconavo-ui/react")).toBe(
      "pnpm add @iconavo-ui/react",
    );
    expect(installCommand("yarn", "@iconavo-ui/react")).toBe(
      "yarn add @iconavo-ui/react",
    );
  });
});

describe("разделы README для get_usage MCP-сервера (шаг 10 фазы 4)", () => {
  it("настоящий README: версия из адреса скрипта и разделы дословно", () => {
    const usage = usageFromReadme(readme);
    expect(usage.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(usage.install).toEqual(installFromReadme(readme));
    expect(usage.sections.install).toMatch(/^\*\*Without a build step\*\*/);
    expect(usage.sections.html).toMatch(/^```html\n<!doctype html>/);
    expect(usage.sections.react).toContain(
      'import { Icon } from "@iconavo-ui/react";',
    );
    expect(usage.sections.next).toContain("IconavoProvider");
    expect(usage.sections.label).toContain('label="Delete"');
    expect(usage.sections.size).toContain('stroke-width="1.5"');
    expect(usage.sections.license).toContain("MIT");
    // Раздел кончается перед следующим заголовком того же уровня.
    expect(usage.sections.react).not.toContain("### Size and color");
    expect(usage.sections.next).not.toContain("### `loadIcons` on the server");
  });

  it("раздела нет — «СТОП» с подсказкой про get_usage", () => {
    expect(() =>
      usageFromReadme(readme.replace("### React\n", "### React app\n")),
    ).toThrow(/раздел «React» — нет.*get_usage/);
  });
});
