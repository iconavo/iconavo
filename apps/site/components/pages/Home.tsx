import { Icon } from "@iconavo-ui/react";
import { DICTIONARIES, type Lang } from "../../lib/i18n";
import { PageLink } from "../PageLink";

// Главная — пока минимальная: настоящая, с поиском, наборами и «Что нового», — шаг 2 фазы 4 (ADR-0037).
export function Home({ lang }: { lang: Lang }) {
  const t = DICTIONARIES[lang];
  return (
    <main id="content" className="container home">
      <h1>Iconavo</h1>
      <p className="lead">{t.homeLead}</p>
      <p>{t.homeBeta}</p>
      <p>
        <PageLink lang={lang} path="/docs" className="button">
          {t.homeDocs}{" "}
          <Icon icon="lucide:arrow-right" className="inline-block" />
        </PageLink>
      </p>
      <div className="showcase" aria-hidden="true">
        <Icon icon="lucide:house" className="inline-block" />
        <Icon icon="tabler:star" className="inline-block" />
        <Icon icon="material-symbols:home-rounded" className="inline-block" />
        <Icon icon="ph:smiley" className="inline-block" />
        <Icon icon="fluent-emoji-flat:rocket" className="inline-block" />
      </div>
    </main>
  );
}
