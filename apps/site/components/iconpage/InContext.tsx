"use client";

import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import type { MockupNeighbour } from "../../lib/mockups";

/**
 * Вкладка In context по макету: иконка в компонентах сайта — кнопки, поле, навигация, меню,
 * переключатель, светлый и тёмный фон (шесть карточек вместо прежних мокапов). Рядом — иконки витрины
 * того же набора в том же стиле (lib/mockups.ts), подпись иконки — первый синоним или имя словами.
 * Компоненты — картинки, а не элементы управления: для скринридера раздел — одна подпись.
 */
export function InContext({
  lang,
  icon,
  label,
  neighbours,
  strokeWidth,
}: {
  lang: Lang;
  icon: string;
  label: string;
  neighbours: MockupNeighbour[];
  /** Толщина линии из настроек — только у иконок, где она меняет рисунок. */
  strokeWidth?: number;
}) {
  const t = DICTIONARIES[lang];
  const own = strokeWidth === undefined ? {} : { strokeWidth };
  const [first, second] = neighbours;
  const row = (n: MockupNeighbour | undefined, key: string) =>
    n === undefined ? null : (
      <span key={key} className="ctx-nav-item">
        <Icon icon={n.icon} height={16} />
        <span>{n.label}</span>
      </span>
    );
  return (
    <ul className="ctx-grid">
      <li className="ctx-card">
        <h3 className="ctx-title">{t.ipCtxButtons}</h3>
        <div className="ctx-stage ctx-buttons" aria-hidden="true">
          <span className="panel-btn panel-btn-primary">
            <Icon icon={icon} height={16} {...own} />
            <span>{label}</span>
          </span>
          <span className="panel-btn panel-btn-outline panel-btn-sm">
            <Icon icon={icon} height={16} {...own} />
            <span>{label}</span>
          </span>
        </div>
      </li>
      <li className="ctx-card">
        <h3 className="ctx-title">{t.ipCtxInput}</h3>
        <div className="ctx-stage" aria-hidden="true">
          <span className="ctx-input">
            <span className="ctx-input-text">{label}</span>
            <Icon icon={icon} height={16} {...own} />
          </span>
        </div>
      </li>
      <li className="ctx-card">
        <h3 className="ctx-title">{t.ipCtxNavigation}</h3>
        <div className="ctx-stage ctx-nav" aria-hidden="true">
          <span className="ctx-nav-item ctx-nav-current">
            <Icon icon={icon} height={16} {...own} />
            <span>{label}</span>
          </span>
          {row(first, "first")}
          {row(second, "second")}
        </div>
      </li>
      <li className="ctx-card">
        <h3 className="ctx-title">{t.ipCtxMenu}</h3>
        <div className="ctx-stage" aria-hidden="true">
          <span className="ctx-menu">
            <span className="ctx-menu-item">
              <Icon icon={icon} height={16} {...own} />
              <span>{label}</span>
            </span>
            {first === undefined ? null : (
              <span className="ctx-menu-item">
                <Icon icon={first.icon} height={16} />
                <span>{first.label}</span>
              </span>
            )}
            {second === undefined ? null : (
              <>
                <span className="ctx-menu-separator" />
                <span className="ctx-menu-item">
                  <Icon icon={second.icon} height={16} />
                  <span>{second.label}</span>
                </span>
              </>
            )}
          </span>
        </div>
      </li>
      <li className="ctx-card">
        <h3 className="ctx-title">{t.ipCtxToggle}</h3>
        <div className="ctx-stage ctx-toggles" aria-hidden="true">
          <span className="ctx-toggle">
            <Icon icon={icon} height={24} {...own} />
            <span className="ctx-toggle-text">
              <span>{label}</span>
              <span className="ctx-toggle-state">{t.ipCtxOn}</span>
            </span>
            <span className="ctx-switch ctx-switch-on" />
          </span>
          {first === undefined ? null : (
            <span className="ctx-toggle">
              <Icon icon={first.icon} height={24} />
              <span className="ctx-toggle-text">
                <span>{first.label}</span>
                <span className="ctx-toggle-state">{t.ipCtxOff}</span>
              </span>
              <span className="ctx-switch" />
            </span>
          )}
        </div>
      </li>
      <li className="ctx-card">
        <h3 className="ctx-title">{t.ipCtxLightDark}</h3>
        <div className="ctx-stage ctx-themes" aria-hidden="true">
          {(["preview-light", "preview-dark"] as const).map((theme) => (
            <span key={theme} className={`ctx-theme ${theme}`}>
              {[16, 20, 24].map((px) => (
                <Icon key={px} icon={icon} height={px} {...own} />
              ))}
            </span>
          ))}
        </div>
      </li>
    </ul>
  );
}
