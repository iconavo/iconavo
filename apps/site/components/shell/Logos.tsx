// Цветные картинки из макета (Figma «Iconavo — Макеты», каркас): логотипы Figma и VS Code, значки «For AI
// agents», значок тарифа, флаги. Лежат в public/logos; это украшение — название всегда написано рядом.

const image = (src: string, size = 16, className = "pill-logo") => (
  // biome-ignore lint/performance/noImgElement: маленькая картинка, оптимизация next/image ей не нужна
  <img src={src} alt="" width={size} height={size} className={className} />
);

export const FigmaLogo = () => image("/logos/figma.png");
export const VSCodeLogo = () => image("/logos/vscode.png");

/** Пара логотипов в пилюле «Extensions»: через 4 px, как в макете. */
export function ExtensionLogos() {
  return (
    <span className="pill-logos">
      <FigmaLogo />
      <VSCodeLogo />
    </span>
  );
}

/** Пара значков «For AI agents»: терминал и звёздочка, через 4 px. */
export function AgentLogos() {
  return (
    <span className="pill-logos">
      {image("/logos/ai-terminal.png")}
      {image("/logos/ai-claude.png")}
    </span>
  );
}

/** Значок тарифа в боковом меню — ромб со звездой, 24 px. */
export const PlanLogo = () => image("/logos/plan.svg", 24, "sidebar-plan-icon");

/** Флаг языка в круглой кнопке верхней полосы и подвала. */
export const FlagLogo = ({ lang }: { lang: "en" | "ru" }) =>
  image(`/logos/flag-${lang}.svg`);

/** Значок Google на кнопках «Log In with Google» и «Sign Up with Google» (рисунок из макета). */
export const GoogleLogo = () =>
  image("/logos/google.svg", 16, "auth-google-logo");
