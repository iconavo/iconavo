import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PREVIEW_SIZES } from "../../lib/icon-page";

/** Плиток «Other styles» и карточек похожих в скелетоне — как в кадре Loading. */
const STYLE_SKELETONS = 6;
const SIMILAR_SKELETONS = 14;

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/**
 * Состояние Loading по макету (кадр «Icon Page / Loading»): пока сервер собирает страницу другой
 * иконки (переход по плитке стиля или похожей), вместо данных — скелетоны, подписи разделов на месте,
 * действия неактивны. Показывает его сама страница на время перехода (components/iconpage/IconView.tsx),
 * а не loading.tsx: с ним в кэше страницы видимым оставался бы скелетон, а страница — скрытой до скрипта.
 * Картинка, а не элементы управления: для скринридера — одна строка «Загружаем иконку…».
 */
export function IconSkeleton({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  return (
    <div className="ip-loading" aria-busy="true">
      <p className="sr-only" role="status">
        {t.ipLoading}
      </p>
      <div className="ip-skeleton-page" aria-hidden="true">
        <div className="crumbs ip-crumbs">
          <span className="ip-skeleton ip-skeleton-crumbs" />
        </div>
        <div className="ip-hero">
          <div className="ip-head">
            <span className="ip-skeleton ip-skeleton-title" />
            <span className="ip-skeleton ip-skeleton-meta" />
          </div>
          <div className="ip-visual">
            <div className="ip-tile">
              <span className="ip-skeleton ip-skeleton-tile" />
            </div>
            <div className="ip-controls">
              <span className="ip-bg">
                <span className="pill-option ip-pressed">{t.ipDark}</span>
                <span className="pill-option">{t.ipLight}</span>
                <span className="pill-option">{t.ipTransparent}</span>
              </span>
              <span className="ip-switch">
                <span>{t.ipGrid}</span>
                <span className="ip-switch-track ip-switch-on" />
              </span>
            </div>
            <div className="ip-block ip-sizes">
              <span className="ip-label">{t.ipSizes}</span>
              <span className="ip-size-row">
                {PREVIEW_SIZES.map((px) => (
                  <span key={px} className="ip-size">
                    <span className="ip-size-box" />
                    <span className="ip-size-label">{px}</span>
                  </span>
                ))}
              </span>
            </div>
          </div>
          <div className="ip-info">
            <div className="ip-block ip-tags">
              <span className="ip-label">{t.ipTags}</span>
              <span className="ip-skeleton ip-skeleton-tags" />
            </div>
            <div className="ip-block ip-cats">
              <span className="ip-label">{t.ipCategories}</span>
              <span className="ip-chips">
                {range(3).map((i) => (
                  <span key={i} className="ip-skeleton ip-skeleton-chip" />
                ))}
              </span>
            </div>
            <div className="ip-pair">
              <span className="panel-field">
                <span className="panel-label">{t.iconSize}</span>
                <span className="panel-control">
                  <Icon
                    icon="material-symbols:height"
                    className="panel-icon panel-icon-muted"
                  />
                  <span className="panel-control-text">24px</span>
                  <Icon
                    icon="material-symbols:keyboard-arrow-down"
                    className="panel-icon"
                  />
                </span>
              </span>
              <span className="panel-field">
                <span className="panel-label">{t.iconColor}</span>
                <span className="panel-control" />
              </span>
            </div>
            <div className="ip-actions ip-actions-off">
              <span className="panel-btn panel-btn-primary">
                <Icon
                  icon="material-symbols:content-copy"
                  className="panel-icon"
                />
                {t.ipCopyFormat.replace("{format}", "SVG")}
                <Icon
                  icon="material-symbols:keyboard-arrow-down"
                  className="panel-icon"
                />
              </span>
              <span className="panel-btn panel-btn-secondary">
                <Icon
                  icon="material-symbols:download"
                  className="panel-icon panel-icon-muted"
                />
                {t.pDownload}
              </span>
              <span className="panel-btn panel-btn-outline ip-bag">
                <Icon
                  icon="site:backpack-add"
                  className="panel-icon ip-bag-wide"
                />
                <span className="ip-bag-wide">{t.ipBagAdd}</span>
                <span className="ip-bag-narrow">+</span>
                <Icon
                  icon="material-symbols:backpack"
                  className="panel-icon ip-bag-narrow"
                />
              </span>
            </div>
            <div className="ip-block ip-styles">
              <span className="ip-label">{t.ipOtherStyles}</span>
              <span className="ip-style-row">
                {range(STYLE_SKELETONS).map((i) => (
                  <span key={i} className="ip-style ip-style-skeleton" />
                ))}
              </span>
            </div>
            <span className="ip-skeleton ip-skeleton-dates" />
          </div>
        </div>
        <div className="ip-tabs">
          <span className="ip-tab ip-tab-selected" data-label={t.ipTabSimilar}>
            {t.ipTabSimilar}
          </span>
          <span className="ip-tab" data-label={t.ipTabCode}>
            {t.ipTabCode}
          </span>
          <span className="ip-tab" data-label={t.ipTabContext}>
            {t.ipTabContext}
          </span>
        </div>
        <div className="ip-tabpanel">
          <span className="ip-skeleton ip-skeleton-lead" />
          <span className="ip-similar">
            {range(SIMILAR_SKELETONS).map((i) => (
              <span key={i} className="ip-similar-card ip-similar-skeleton">
                <span className="ip-skeleton ip-skeleton-icon" />
                <span className="ip-skeleton ip-skeleton-name" />
                <span className="ip-skeleton ip-skeleton-set" />
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
