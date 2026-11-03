"use client";

import { type CopyWhat, track } from "../../lib/analytics";
import { API } from "../../lib/api";
import {
  type Applies,
  CODE_KINDS,
  type CodeKind,
  cssCode,
  reactCode,
  svgCode,
  svgLink,
  tagCode,
} from "../../lib/code";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { useIconSettings } from "../../lib/icon-settings";
import {
  builtInstall,
  installCommand,
  PACKAGE_MANAGERS,
} from "../../lib/install";
import { codeStore, pmStore, useChoice } from "../../lib/prefs";
import { CodeBlock } from "../CodeBlock";
import { buttonClass } from "../ui/button";
import { useIconData } from "./useIconData";

// Строки README этой сборки (next.config.ts): установка, подключение и страницы без сборщика.
const INSTALL = builtInstall();

/**
 * Генератор кода (шаг 5 фазы 4, ADR-0042): тег, React, SVG, CSS и ссылка на SVG edge API — с настройками
 * превью. Вид кода и менеджер пакетов запоминаются (lib/prefs.ts); переключатели — кнопки с
 * aria-pressed, как у поворота: вкладки Radix ставят атрибут style в серверный HTML, а CSP его не
 * пускает (ADR-0038). Копирование — метка аналитики (ADR-0043).
 */
export function IconCode({
  lang,
  name,
  applies,
  H,
}: {
  lang: Lang;
  name: string;
  applies: Applies;
  H: "h2" | "h3";
}) {
  const t = DICTIONARIES[lang];
  const s = useIconSettings();
  const kind = useChoice(codeStore);
  const pm = useChoice(pmStore);
  const icon = useIconData(name, kind === "svg");
  const labels = { copy: t.iconCopy, copied: t.iconCopied };
  const copied = (what: CopyWhat) => () =>
    track({ name: "copy", what, icon: name });
  const pressed = (on: boolean) =>
    buttonClass(on ? "primary" : "outline", "md", "icon-setting-toggle");
  const titles: Record<CodeKind, string> = {
    tag: t.codeTag,
    react: "React",
    svg: "SVG",
    css: "CSS",
    link: t.codeLink,
  };

  const block = (
    snippet: string,
    what: CopyWhat,
    language: string,
    title: string,
    value: string,
  ) => (
    <CodeBlock
      lang={language}
      value={value}
      title={title}
      labels={labels}
      onCopied={copied(what)}
      snippet={snippet}
      wrap
    />
  );
  const install = (pkg: string) => (
    <>
      <fieldset className="icon-code-choice">
        <legend className="sr-only">{t.iconPackageManager}</legend>
        <span className="icon-setting-buttons">
          {PACKAGE_MANAGERS.map((m) => (
            <button
              key={m}
              type="button"
              className={pressed(m === pm)}
              aria-pressed={m === pm}
              onClick={() => pmStore.set(m)}
            >
              {m}
            </button>
          ))}
        </span>
      </fieldset>
      {block(
        "install",
        "install",
        "sh",
        t.iconInstall,
        installCommand(pm, pkg),
      )}
    </>
  );

  return (
    <section className="icon-section icon-code" data-code={kind}>
      <H className="icon-section-title">{t.iconCode}</H>
      <fieldset className="icon-code-choice">
        <legend className="sr-only">{t.iconCodeKind}</legend>
        <span className="icon-setting-buttons">
          {CODE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={pressed(k === kind)}
              aria-pressed={k === kind}
              onClick={() => codeStore.set(k)}
            >
              {titles[k]}
            </button>
          ))}
        </span>
      </fieldset>
      {kind === "tag" ? (
        <>
          {install(INSTALL.tag.package)}
          {block("import", "import", "js", t.iconImport, INSTALL.tag.import)}
          {block("code", "tag", "html", t.iconUsage, tagCode(name, s, applies))}
          {block("script", "script", "html", t.iconNoBundler, INSTALL.script)}
        </>
      ) : null}
      {kind === "react" ? (
        <>
          {install(INSTALL.react.package)}
          {block(
            "code",
            "react",
            "jsx",
            t.iconUsage,
            reactCode(name, s, applies, INSTALL),
          )}
        </>
      ) : null}
      {kind === "svg" ? (
        icon === undefined ? (
          <p className="icon-setting-note" aria-live="polite">
            {t.iconCodeLoading}
          </p>
        ) : icon === null ? (
          <p className="icon-setting-note" role="alert">
            {t.iconCodeFailed}
          </p>
        ) : (
          block("code", "svg", "html", "SVG", svgCode(icon, s, applies))
        )
      ) : null}
      {kind === "css" ? (
        <>
          {block("code", "css", "html", "CSS", cssCode(API, name, s, applies))}
          <p className="icon-setting-note">{t.iconCssNote}</p>
        </>
      ) : null}
      {kind === "link"
        ? block("code", "link", "", t.codeLink, svgLink(API, name, s, applies))
        : null}
    </section>
  );
}
