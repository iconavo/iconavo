"use client";

// Мокапы страницы иконки (шаг 4 фазы 4, ADR-0041; утверждены владельцем 2 ноября 2026): выбранная иконка
// с настройками вкладки (lib/icon-settings.ts) в восьми местах интерфейса, в светлой и тёмной теме; рядом —
// иконки витрины того же набора в том же стиле, без настроек (lib/mockups.ts). Размер у каждого места свой,
// размер из настроек меняет только превью. Мокапы стоят вне IconavoProvider страницы: в серверном HTML —
// заглушки нужного размера (страница в кэше легче, место не прыгает), рисунки догружает браузер. Мокап —
// картинка, а не интерфейс: внутри нет кнопок и ссылок, а для экранных дикторов он скрыт.

import { Icon } from "@iconavo-ui/react";
import { type ReactNode, useId } from "react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { iconProps, useIconSettings } from "../../lib/icon-settings";
import type { MockupNeighbour } from "../../lib/mockups";
import "../../lib/iconavo";

export interface IconMockupsProps {
  lang: Lang;
  icon: string;
  /** Подпись иконки — mockupLabel. */
  label: string;
  /** Соседи из витрины набора с подписями — pickNeighbours. */
  neighbours: MockupNeighbour[];
  palette: boolean;
  strokes: boolean;
}

/** Иконка рамки мокапов: «закрыть» — Lucide, как у сайта. */
const CLOSE = "lucide:x";

export function IconMockups({
  lang,
  icon,
  label,
  neighbours,
  palette,
  strokes,
}: IconMockupsProps) {
  const t = DICTIONARIES[lang];
  const s = useIconSettings();
  const id = useId();
  const main = (size: number) => (
    <Icon icon={icon} {...iconProps(s, { size, palette, strokes })} />
  );
  /** Соседи с номерами from…to-1, сколько есть. */
  const near = (from: number, to: number) =>
    neighbours
      .slice(from, to)
      .map((n, k) => ({ name: n.icon, i: from + k, label: n.label }));
  const muted = (name: string, size: number) => (
    <span className="mockup-muted">
      <Icon icon={name} height={size} />
    </span>
  );

  const mockups: {
    id: string;
    title: string;
    size: number;
    render: () => ReactNode;
  }[] = [
    {
      id: "buttons",
      title: t.mockupButtons,
      size: 20,
      render: () => (
        <div className="mockup-buttons">
          <span className="mockup-btn mockup-btn-primary">
            {main(20)}
            <span>{label}</span>
          </span>
          <span className="mockup-btn mockup-btn-outline">
            {main(20)}
            <span>{label}</span>
          </span>
          <span className="mockup-btn mockup-btn-icon">{main(20)}</span>
        </div>
      ),
    },
    {
      id: "tabs",
      title: t.mockupTabs,
      size: 24,
      render: () => (
        <div className="mockup-phone">
          <div className="mockup-screen" />
          <div className="mockup-tabs">
            <span className="mockup-tab mockup-active">
              {main(24)}
              <span>{label}</span>
            </span>
            {near(0, 3).map((n) => (
              <span key={n.i} className="mockup-tab">
                <Icon icon={n.name} height={24} />
                <span>{n.label}</span>
              </span>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: "menu",
      title: t.mockupMenu,
      size: 18,
      render: () => (
        <div className="mockup-menu">
          {near(2, 3).map((n) => (
            <div key={n.i} className="mockup-item">
              {muted(n.name, 18)}
              <span>{n.label}</span>
              <kbd>⌘P</kbd>
            </div>
          ))}
          <div className="mockup-item mockup-hover">
            {main(18)}
            <span>{label}</span>
            <kbd>⌘K</kbd>
          </div>
          {near(1, 2).map((n) => (
            <div key={n.i} className="mockup-item">
              {muted(n.name, 18)}
              <span>{n.label}</span>
              <kbd>⌘,</kbd>
            </div>
          ))}
          {near(3, 4).map((n) => (
            <div key={n.i} className="mockup-item">
              {muted(n.name, 18)}
              <span>{n.label}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "input",
      title: t.mockupInput,
      size: 20,
      render: () => (
        <div className="mockup-input">
          {main(20)}
          <span className="mockup-input-text">{t.mockupInputText}</span>
          {muted(CLOSE, 16)}
        </div>
      ),
    },
    {
      id: "toast",
      title: t.mockupToast,
      size: 24,
      render: () => (
        <div className="mockup-toast">
          {main(24)}
          <div className="mockup-toast-text">
            <strong>{label}</strong>
            <p>{t.mockupToastText}</p>
          </div>
          {muted(CLOSE, 16)}
        </div>
      ),
    },
    {
      id: "tiles",
      title: t.mockupTiles,
      size: 36,
      render: () => (
        <div className="mockup-tiles">
          <span className="mockup-tile">
            {/* Цветная иконка — на светлой плитке: на плитке цвета акцента её краски терялись бы. */}
            <span
              className={
                palette ? "mockup-tile-box" : "mockup-tile-box mockup-tile-main"
              }
            >
              {main(36)}
            </span>
            <span className="mockup-tile-label">{label}</span>
          </span>
          {near(0, 3).map((n) => (
            <span key={n.i} className="mockup-tile">
              <span className="mockup-tile-box">
                <Icon icon={n.name} height={36} />
              </span>
              <span className="mockup-tile-label">{n.label}</span>
            </span>
          ))}
        </div>
      ),
    },
    {
      id: "toolbar",
      title: t.mockupToolbar,
      size: 20,
      render: () => (
        <div className="mockup-toolbar">
          {near(0, 2).map((n) => (
            <span key={n.i} className="mockup-tool">
              <Icon icon={n.name} height={20} />
            </span>
          ))}
          <span className="mockup-tool mockup-on">{main(20)}</span>
          {near(2, 4).map((n) => (
            <span key={n.i} className="mockup-tool">
              <Icon icon={n.name} height={20} />
            </span>
          ))}
        </div>
      ),
    },
    {
      id: "sidebar",
      title: t.mockupSidebar,
      size: 20,
      render: () => (
        <div className="mockup-sidebar">
          <span className="mockup-nav mockup-active">
            {main(20)}
            <span>{label}</span>
          </span>
          {near(0, 3).map((n) => (
            <span key={n.i} className="mockup-nav">
              <Icon icon={n.name} height={20} />
              <span>{n.label}</span>
            </span>
          ))}
        </div>
      ),
    },
  ];

  return (
    <section className="page-section mockups" aria-labelledby={`${id}-mockups`}>
      <h2 id={`${id}-mockups`}>{t.mockupsTitle}</h2>
      <p className="mockups-lead">{t.mockupsLead}</p>
      {mockups.map((m) => (
        <div key={m.id} className="mockup" data-mockup={m.id}>
          <div className="mockup-head">
            <h3>{m.title}</h3>
            <p className="mockup-size">{m.size} px</p>
          </div>
          {(["light", "dark"] as const).map((scheme) => (
            <div
              key={scheme}
              className={`mockup-pane mockup-${scheme}`}
              aria-hidden="true"
            >
              <span className="mockup-theme">
                {scheme === "light" ? t.mockupLight : t.mockupDark}
              </span>
              {m.render()}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
