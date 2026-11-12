"use client";

import type { IconData } from "@iconavo-ui/core/internal";
import { Icon } from "@iconavo-ui/react";
import { type CopyWhat, track } from "../../lib/analytics";
import { API } from "../../lib/api";
import { type Applies, fileName, reactCode } from "../../lib/code";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import type { IconSettings } from "../../lib/icon-settings";
import {
  builtInstall,
  installCommand,
  PACKAGE_MANAGERS,
  type PackageManager,
} from "../../lib/install";
import {
  backgroundCode,
  cssClassCode,
  cssClassName,
  cssSpanCode,
  formatOf,
  imgCode,
  type PanelView,
  panelSettings,
  plainSvg,
  readSvgOptions,
  svgDataUrl,
  svgOptionsValue,
  svgView,
  tagView,
  urlView,
} from "../../lib/panel-code";
import {
  panelViewStore,
  pmStore,
  svgOptionsStore,
  useChoice,
} from "../../lib/prefs";
import { PageLink } from "../PageLink";
import {
  CodeBlock,
  PanelCopy,
  PanelOption,
  PanelTab,
  PanelTabs,
  Pill,
  PillGroup,
} from "./parts";

/** Логотипы менеджеров пакетов — как в макете (Figma, icons/brand/…), файлами в public/logos. */
const PM_LOGOS: Record<PackageManager, string> = {
  npm: "/logos/npm.svg",
  pnpm: "/logos/pnpm.svg",
  yarn: "/logos/yarn.svg",
};

const pick = (view: PanelView) => () => panelViewStore.set(view);

/**
 * Блок кода панели по макету (Icon Panel/Code, 29 видов): форматы SVG and CSS и Components, подвкладки,
 * настройки и сам код. Работают SVG, CSS, CSS · URL, HTML (веб-компонент <iconavo-icon>, решение
 * владельца 12 ноября 2026) и React · Package; остальное — «Soon». Вид запоминается (lib/prefs.ts).
 */
export function PanelCode({
  lang,
  name,
  icon,
  s,
  applies,
}: {
  lang: Lang;
  name: string;
  /** Рисунок иконки; до ответа ядра — undefined, не нашёлся — null. */
  icon: IconData | null | undefined;
  s: IconSettings;
  applies: Applies;
}) {
  const t = DICTIONARIES[lang];
  const view = useChoice(panelViewStore);
  const format = formatOf(view);
  const settings = panelSettings(s);
  const copied = (what: CopyWhat) => () =>
    track({ name: "copy", what, icon: name });

  return (
    <div className="panel-code">
      <div className="pill-groups">
        <PillGroup label={t.pGroupSvg}>
          <Pill lang={lang} selected={format === "svg"} onSelect={pick("svg")}>
            SVG
          </Pill>
          <Pill lang={lang} soon>
            SVG+CSS
          </Pill>
          <Pill lang={lang} selected={format === "css"} onSelect={pick("css")}>
            CSS
          </Pill>
        </PillGroup>
        <PillGroup label={t.pGroupComponents}>
          <Pill
            lang={lang}
            selected={format === "html"}
            onSelect={pick("html")}
          >
            HTML
          </Pill>
          <Pill
            lang={lang}
            selected={format === "react"}
            onSelect={pick("react")}
          >
            React
          </Pill>
          {["Vue", "Svelte", "Solid", "Astro"].map((label) => (
            <Pill key={label} lang={lang} soon>
              {label}
            </Pill>
          ))}
        </PillGroup>
      </div>
      <PanelTabs label={t.pTabsLabel}>
        {format === "svg" ? (
          <>
            <PanelTab lang={lang} selected>
              SVG
            </PanelTab>
            <PanelTab lang={lang} soon>
              {t.pTabJsx}
            </PanelTab>
            <PanelTab lang={lang} soon>
              {t.pTabSymbol}
            </PanelTab>
          </>
        ) : format === "css" ? (
          <>
            <PanelTab
              lang={lang}
              selected={view === "css"}
              onSelect={pick("css")}
            >
              CSS
            </PanelTab>
            <PanelTab lang={lang} soon>
              {t.pTabTailwind}
            </PanelTab>
            <PanelTab lang={lang} soon>
              {t.pTabUnocss}
            </PanelTab>
            <PanelTab
              lang={lang}
              selected={view === "css-url"}
              onSelect={pick("css-url")}
            >
              {t.pTabUrl}
            </PanelTab>
          </>
        ) : format === "html" ? (
          <>
            <PanelTab
              lang={lang}
              selected={view === "html"}
              onSelect={pick("html")}
            >
              {t.pTabPackage}
            </PanelTab>
            <PanelTab
              lang={lang}
              selected={view === "html-script"}
              onSelect={pick("html-script")}
            >
              {t.pTabScript}
            </PanelTab>
          </>
        ) : (
          <>
            <PanelTab lang={lang} selected>
              {t.pTabPackage}
            </PanelTab>
            <PanelTab lang={lang} soon>
              {t.pTabComponent}
            </PanelTab>
            <PanelTab lang={lang} soon>
              {t.pTabUnplugin}
            </PanelTab>
            <PanelTab lang={lang} soon>
              {t.pTabUnpluginIcons}
            </PanelTab>
          </>
        )}
      </PanelTabs>
      {view === "svg" ? (
        <SvgView
          lang={lang}
          name={name}
          icon={icon}
          s={settings}
          applies={applies}
        />
      ) : view === "css" ? (
        icon ? (
          <>
            <CodeBlock
              lang={lang}
              label="CSS"
              code={cssClassCode(name, icon, settings, applies)}
              limited
              download={{
                name: `${cssClassName(name)}.css`,
                type: "text/css",
              }}
              onCopied={copied("css")}
            />
            <DataUrl lang={lang} icon={icon} s={settings} applies={applies} />
            <CodeBlock
              lang={lang}
              label="HTML"
              code={cssSpanCode(name)}
              onCopied={copied("css")}
            />
          </>
        ) : null
      ) : view === "css-url" ? (
        icon ? (
          <UrlView
            lang={lang}
            name={name}
            icon={icon}
            s={settings}
            applies={applies}
          />
        ) : null
      ) : view === "html-script" ? (
        <>
          <CodeBlock
            lang={lang}
            label="HTML"
            code={`${builtInstall().script}\n\n${tagView(name, settings, applies)}`}
            onCopied={copied("script")}
          />
          <DocsLink lang={lang} path="/docs#html" label={t.pDocsTag} />
        </>
      ) : (
        <PackageView
          lang={lang}
          kind={view === "html" ? "tag" : "react"}
          usage={
            view === "html"
              ? `${builtInstall().tag.import}\n\n${tagView(name, settings, applies)}`
              : reactCode(name, settings, applies, builtInstall())
          }
          onCopied={copied(view === "html" ? "tag" : "react")}
        />
      )}
    </div>
  );
}

/** SVG · SVG: настройки вывода, код с прокруткой и скачиванием, «Copy as data URL». */
function SvgView({
  lang,
  name,
  icon,
  s,
  applies,
}: {
  lang: Lang;
  name: string;
  icon: IconData | null | undefined;
  s: IconSettings;
  applies: Applies;
}) {
  const t = DICTIONARIES[lang];
  const options = readSvgOptions(useChoice(svgOptionsStore));
  const set = (change: Partial<typeof options>) =>
    svgOptionsStore.set(svgOptionsValue({ ...options, ...change }));
  return (
    <>
      <div className="panel-options">
        <PanelOption
          checked={options.pretty}
          onChange={(v) => set({ pretty: v })}
        >
          {t.pPrettify}
        </PanelOption>
        <PanelOption checked={options.rect} onChange={(v) => set({ rect: v })}>
          {t.pEmptyRect}
        </PanelOption>
        <PanelOption
          checked={options.comment}
          onChange={(v) => set({ comment: v })}
        >
          {t.pComment}
        </PanelOption>
      </div>
      {icon ? (
        <>
          <CodeBlock
            lang={lang}
            label="SVG"
            code={svgView(name, icon, s, applies, options)}
            limited
            download={{ name: fileName(name, "svg"), type: "image/svg+xml" }}
            onCopied={() => track({ name: "copy", what: "svg", icon: name })}
          />
          <DataUrl lang={lang} icon={icon} s={s} applies={applies} />
        </>
      ) : null}
    </>
  );
}

/** «Copy as data URL» — SVG одной строкой в адресе data:, как у Iconify. */
function DataUrl({
  lang,
  icon,
  s,
  applies,
}: {
  lang: Lang;
  icon: IconData;
  s: IconSettings;
  applies: Applies;
}) {
  const t = DICTIONARIES[lang];
  return (
    <div className="panel-row">
      <PanelCopy
        lang={lang}
        text={svgDataUrl(plainSvg(icon, s, applies))}
        icon="material-symbols:link"
        label={t.pDataUrl}
        className="panel-btn panel-btn-outline panel-btn-sm"
        onCopied={() => track({ name: "copy", what: "data-url" })}
      />
    </div>
  );
}

/** CSS · URL: адрес SVG edge API, картинка и фон; ссылка на документацию API. */
function UrlView({
  lang,
  name,
  icon,
  s,
  applies,
}: {
  lang: Lang;
  name: string;
  icon: IconData;
  s: IconSettings;
  applies: Applies;
}) {
  const t = DICTIONARIES[lang];
  const url = urlView(API, name, s, applies);
  return (
    <>
      <CodeBlock lang={lang} label={t.pSvgUrl} code={url} />
      <CodeBlock
        lang={lang}
        label="HTML"
        code={imgCode(url, name, icon, s.size)}
      />
      <CodeBlock lang={lang} label="CSS" code={backgroundCode(url)} />
      <DocsLink lang={lang} path="/docs/api" label={t.pDocsApi} />
    </>
  );
}

/** Package: менеджер пакетов, установка и пример; ссылка на документацию пакета. */
function PackageView({
  lang,
  kind,
  usage,
  onCopied,
}: {
  lang: Lang;
  kind: "tag" | "react";
  usage: string;
  onCopied: () => void;
}) {
  const t = DICTIONARIES[lang];
  const pm = useChoice(pmStore);
  const install = builtInstall();
  return (
    <>
      <PillGroup label={t.pPm}>
        {PACKAGE_MANAGERS.map((p) => (
          <Pill
            key={p}
            lang={lang}
            selected={p === pm}
            logo={PM_LOGOS[p]}
            onSelect={() => pmStore.set(p)}
          >
            {p}
          </Pill>
        ))}
      </PillGroup>
      <CodeBlock
        lang={lang}
        label={t.pInstall}
        code={installCommand(pm, install[kind].package)}
        onCopied={onCopied}
      />
      <CodeBlock
        lang={lang}
        label={t.pUsage}
        code={usage}
        onCopied={onCopied}
      />
      <DocsLink
        lang={lang}
        path={kind === "react" ? "/docs#react" : "/docs#html"}
        label={kind === "react" ? t.pDocsReact : t.pDocsTag}
      />
    </>
  );
}

/** Ссылка на документацию со стрелкой (макет: «React package docs ↗»). */
function DocsLink({
  lang,
  path,
  label,
}: {
  lang: Lang;
  path: string;
  label: string;
}) {
  return (
    <p className="panel-docs">
      <PageLink lang={lang} path={path}>
        {label}
      </PageLink>
      <Icon icon="material-symbols:arrow-outward" className="panel-icon" />
    </p>
  );
}
