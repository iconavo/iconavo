import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { Cabinet } from "../account/Cabinet";
import { Soon } from "../shell/Soon";

/**
 * Страница «Account» (шаг 3 фазы 5, PR 4; кадр «A2 · Account / My Account»): шапка как у страниц сайта —
 * заголовок, пояснение и вкладки «My account» и «Plan & licenses» («Soon»: тарифы — фаза 8). Страница
 * статическая и всегда скрыта от поисковиков; всё, что про человека, приходит в браузере (Cabinet).
 */
export function AccountPage({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  return (
    <main id="content" className="account-page">
      <header className="account-head">
        <h1 className="account-title">{t.accountTitle}</h1>
        <p className="account-lead">{t.accountLead}</p>
        <div className="account-tabs">
          <span className="account-tab" aria-current="page">
            {t.accountTabMine}
          </span>
          <Soon lang={lang} className="account-tab">
            {t.accountTabPlan}
          </Soon>
        </div>
      </header>
      <Cabinet lang={lang} />
    </main>
  );
}
