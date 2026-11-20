// Сценарии проверки MCP-сервера в клиентах (шаг 12 фазы 4, ADR-0044): 20 запросов человека на русском
// и английском — найти иконку, вставить код, собрать набор в одном стиле, лицензии. Признаки одни для
// всех клиентов: Claude Code прогоняется автоматически (clients.ts), Claude и ChatGPT — владельцем по
// таблице. Подходящие иконки — явные списки основ имён «набор:основа»: вариант стиля (-bold, -fill,
// -outline…) отрезается по таблице суффиксов набора, поэтому ph:share-fill подходит, а share-off — нет.

import type { Style } from "@iconavo-ui/search";

export type ScenarioGroup = "find" | "code" | "set" | "license";
/** Вид кода: any — любой код иконки (тег, React, SVG или CSS). */
export type CodeKind = "html" | "react" | "svg" | "css" | "next" | "any";
export type ProjectKind = "html" | "react";

export interface SetRule {
  /** Понятие → подходящие основы имён без набора: house, magnifying-glass… */
  concepts: Readonly<Record<string, readonly string[]>>;
  /** Набор задан человеком. */
  prefix?: string;
  /** Стиль задан человеком. */
  style?: Style;
  /** Вариант у всех иконок, например -bold у ph:house-bold. */
  suffix?: string;
}

export interface ClientScenario {
  id: number;
  lang: "ru" | "en";
  group: ScenarioGroup;
  /** Запрос человека — дословно. */
  prompt: string;
  /** Запрос для чатов без проекта: с текстом файла, куда вставлять. */
  chatPrompt?: string;
  /** Проект в папке сценария: ассистент вставляет код в него, прогон собирает его и открывает. */
  project?: ProjectKind;
  /**
   * Нужный инструмент — любой из списка. В проекте ассистент может найти иконку поиском и собрать
   * компонент сам по get_usage: код тот же, засчитываем (первый прогон 20 ноября 2026, сценарий 9).
   */
  tools: readonly string[];
  /** Подходящие иконки «набор:основа»; нет — иконку не оцениваем. */
  icons?: readonly string[];
  /** Стиль выбранной иконки. */
  style?: Style;
  /** Вид кода; нет — код не нужен. */
  code?: CodeKind;
  /** Проверка кода сверх вида: текст проблемы или undefined. */
  codeCheck?: (code: string) => string | undefined;
  /** Названы лицензия и автор. */
  license?: boolean;
  /** Проверка ответа сверх лицензии: текст проблемы или undefined. */
  answerCheck?: (text: string) => string | undefined;
  /** Набор в одном стиле. */
  set?: SetRule;
}

const HTML_FILE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>My tasks</title>
  </head>
  <body>
    <nav><a href="/">Home</a></nav>
    <h1>My tasks</h1>
    <ul>
      <li>Buy milk <button type="button">Delete</button></li>
      <li>Call Anna <button type="button">Delete</button></li>
    </ul>
  </body>
</html>`;

const APP_FILE = `export function App() {
  return (
    <>
      <header className="header">
        <span className="logo">Acme</span>
        <nav className="nav">
          <a href="/">Dashboard</a>
          <a href="/projects">Projects</a>
        </nav>
        <button type="button" className="settings">
          Settings
        </button>
      </header>
      <main>
        <h1>Dashboard</h1>
        <p>Welcome back.</p>
      </main>
    </>
  );
}`;

/** Красный цвет в коде: hex с заметным красным или слово. */
export function redProblem(code: string): string | undefined {
  const colors = [
    ...code.matchAll(/color\s*[=:]\s*\{?\s*["']?(#[0-9a-fA-F]{3,8}|[a-z]+)/g),
  ].map((m) => (m[1] ?? "").toLowerCase());
  const red = colors.some((c) => {
    if (["red", "crimson", "firebrick", "darkred", "tomato"].includes(c)) {
      return true;
    }
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c)?.[1];
    if (hex === undefined) return false;
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((x) => x + x)
            .join("")
        : hex;
    const [r, g, b] = [0, 2, 4].map((i) =>
      Number.parseInt(full.slice(i, i + 2), 16),
    );
    return (r ?? 0) >= 0xb0 && (g ?? 255) <= 0x70 && (b ?? 255) <= 0x80;
  });
  return red ? undefined : "цвет не красный";
}

const has = (text: string, re: RegExp) => re.test(text);

export const CLIENT_SCENARIOS: readonly ClientScenario[] = [
  {
    id: 1,
    lang: "ru",
    group: "find",
    prompt: "Найди иконку для кнопки «поделиться»",
    tools: ["pick_icon", "search_icons"],
    icons: [
      "lucide:share",
      "lucide:share-2",
      "tabler:share",
      "tabler:share-2",
      "tabler:share-3",
      "material-symbols:share",
      "material-symbols:ios-share",
      "ph:share",
      "ph:share-network",
      "ph:share-fat",
      "ph:export",
    ],
    code: "any",
    license: true,
  },
  {
    id: 2,
    lang: "en",
    group: "find",
    prompt: "I need an icon for a shopping cart in my online store",
    tools: ["pick_icon", "search_icons"],
    icons: [
      "lucide:shopping-cart",
      "lucide:shopping-basket",
      "lucide:shopping-bag",
      "tabler:shopping-cart",
      "tabler:basket",
      "tabler:shopping-bag",
      "material-symbols:shopping-cart",
      "material-symbols:add-shopping-cart",
      "material-symbols:shopping-basket",
      "material-symbols:shopping-bag",
      "material-symbols:local-mall",
      "ph:shopping-cart",
      "ph:shopping-cart-simple",
      "ph:basket",
      "ph:shopping-bag",
      "ph:shopping-bag-open",
      "ph:bag",
      "ph:bag-simple",
      "fluent-emoji-flat:shopping-cart",
    ],
    code: "any",
    license: true,
  },
  {
    id: 3,
    lang: "ru",
    group: "find",
    prompt: "Подбери иконку для переключателя тёмной темы",
    tools: ["pick_icon", "search_icons"],
    icons: [
      "lucide:moon",
      "lucide:sun-moon",
      "lucide:moon-star",
      "lucide:contrast",
      "tabler:moon",
      "tabler:moon-2",
      "tabler:moon-stars",
      "tabler:sun-moon",
      "tabler:contrast",
      "tabler:contrast-2",
      "tabler:brightness",
      "tabler:brightness-half",
      "tabler:circle-half",
      "tabler:circle-half-2",
      "material-symbols:dark-mode",
      "material-symbols:light-mode",
      "material-symbols:contrast",
      "material-symbols:brightness-4",
      "material-symbols:brightness-6",
      "material-symbols:nightlight",
      "material-symbols:mode-night",
      "ph:moon",
      "ph:moon-stars",
      "ph:circle-half",
      "ph:circle-half-tilt",
      "fluent-emoji-flat:crescent-moon",
    ],
    code: "any",
    license: true,
  },
  {
    id: 4,
    lang: "en",
    group: "find",
    prompt: "Find a filled bookmark icon",
    tools: ["pick_icon", "search_icons"],
    icons: [
      "material-symbols:bookmark",
      "tabler:bookmark",
      "ph:bookmark",
      "ph:bookmark-simple",
    ],
    style: "filled",
    code: "any",
    license: true,
  },
  {
    id: 5,
    lang: "ru",
    group: "find",
    prompt: "Нужна иконка-эмодзи с сердцем для лайков",
    tools: ["pick_icon", "search_icons"],
    icons: [
      "fluent-emoji-flat:red-heart",
      "fluent-emoji-flat:heart-suit",
      "fluent-emoji-flat:sparkling-heart",
      "fluent-emoji-flat:growing-heart",
      "fluent-emoji-flat:beating-heart",
      "fluent-emoji-flat:two-hearts",
      "fluent-emoji-flat:revolving-hearts",
      "fluent-emoji-flat:heart-decoration",
      "fluent-emoji-flat:pink-heart",
      "fluent-emoji-flat:heart-with-ribbon",
      "fluent-emoji-flat:heart-with-arrow",
      "fluent-emoji-flat:orange-heart",
      "fluent-emoji-flat:yellow-heart",
      "fluent-emoji-flat:green-heart",
      "fluent-emoji-flat:blue-heart",
      "fluent-emoji-flat:light-blue-heart",
      "fluent-emoji-flat:purple-heart",
      "fluent-emoji-flat:white-heart",
      "fluent-emoji-flat:heart-hands",
    ],
    code: "any",
    license: true,
  },
  {
    id: 6,
    lang: "en",
    group: "find",
    prompt: "Icon for an 'Achievements' section in a learning app",
    tools: ["pick_icon", "search_icons"],
    icons: [
      "lucide:trophy",
      "lucide:award",
      "lucide:medal",
      "lucide:crown",
      "lucide:star",
      "lucide:badge-check",
      "tabler:trophy",
      "tabler:award",
      "tabler:medal",
      "tabler:medal-2",
      "tabler:crown",
      "tabler:rosette",
      "tabler:star",
      "material-symbols:trophy",
      "material-symbols:military-tech",
      "material-symbols:workspace-premium",
      "material-symbols:star",
      "ph:trophy",
      "ph:medal",
      "ph:medal-military",
      "ph:crown",
      "ph:star",
      "ph:seal-check",
      "fluent-emoji-flat:trophy",
      "fluent-emoji-flat:sports-medal",
      "fluent-emoji-flat:1st-place-medal",
      "fluent-emoji-flat:military-medal",
      "fluent-emoji-flat:crown",
      "fluent-emoji-flat:glowing-star",
      "fluent-emoji-flat:star",
    ],
    code: "any",
    license: true,
  },
  {
    id: 7,
    lang: "ru",
    group: "find",
    prompt: "Найди иконку «скачать PDF»",
    tools: ["pick_icon", "search_icons"],
    icons: [
      "lucide:file-down",
      "lucide:download",
      "tabler:file-download",
      "tabler:file-type-pdf",
      "tabler:pdf",
      "tabler:download",
      "material-symbols:picture-as-pdf",
      "material-symbols:download",
      "ph:file-pdf",
      "ph:file-arrow-down",
      "ph:download",
      "ph:download-simple",
    ],
    code: "any",
    license: true,
  },
  {
    id: 8,
    lang: "en",
    group: "code",
    prompt: "Add a trash icon to the Delete button in index.html",
    chatPrompt: `Add a trash icon to the Delete button in this index.html:\n\n\`\`\`html\n${HTML_FILE}\n\`\`\``,
    project: "html",
    tools: ["get_icon", "search_icons", "pick_icon"],
    icons: [
      "lucide:trash",
      "lucide:trash-2",
      "tabler:trash",
      "tabler:trash-x",
      "material-symbols:delete",
      "material-symbols:delete-forever",
      "ph:trash",
      "ph:trash-simple",
    ],
    code: "html",
    license: true,
  },
  {
    id: 9,
    lang: "ru",
    group: "code",
    prompt: "Вставь иконку настроек в шапку моего React-приложения",
    chatPrompt: `Вставь иконку настроек в шапку моего React-приложения. Вот src/App.tsx:\n\n\`\`\`tsx\n${APP_FILE}\n\`\`\``,
    project: "react",
    tools: ["get_icon", "search_icons", "pick_icon"],
    icons: [
      "lucide:settings",
      "lucide:settings-2",
      "lucide:cog",
      "tabler:settings",
      "tabler:settings-2",
      "material-symbols:settings",
      "ph:gear",
      "ph:gear-six",
      "ph:gear-fine",
    ],
    code: "react",
    license: true,
  },
  {
    id: 10,
    lang: "en",
    group: "code",
    prompt: "Give me the React code for lucide:house, 32 px, red",
    tools: ["get_icon"],
    icons: ["lucide:house"],
    code: "react",
    codeCheck: (code) =>
      [
        has(code, /width\s*=\s*\{?\s*["']?32\b/) ? "" : "размер не 32",
        redProblem(code) ?? "",
      ]
        .filter(Boolean)
        .join("; ") || undefined,
    license: true,
  },
  {
    id: 11,
    lang: "ru",
    group: "code",
    prompt: "Дай чистый SVG иконки поиска из Tabler, без пакетов",
    tools: ["get_icon"],
    icons: ["tabler:search"],
    code: "svg",
    license: true,
  },
  {
    id: 12,
    lang: "en",
    group: "code",
    prompt: "I need a CSS class for a download icon, no JavaScript",
    tools: ["get_icon"],
    icons: [
      "lucide:download",
      "lucide:file-down",
      "lucide:arrow-down-to-line",
      "tabler:download",
      "tabler:file-download",
      "material-symbols:download",
      "ph:download",
      "ph:download-simple",
      "ph:arrow-line-down",
    ],
    code: "css",
    license: true,
  },
  {
    id: 13,
    lang: "ru",
    group: "code",
    prompt: "Как подключить иконки Iconavo в Next.js App Router?",
    tools: ["get_usage"],
    code: "next",
  },
  {
    id: 14,
    lang: "en",
    group: "code",
    prompt: "Use lucide:home in my page",
    chatPrompt: `Use lucide:home in my page:\n\n\`\`\`html\n${HTML_FILE}\n\`\`\``,
    project: "html",
    tools: ["get_icon", "search_icons", "pick_icon"],
    icons: ["lucide:house"],
    code: "html",
    license: true,
  },
  {
    id: 15,
    lang: "ru",
    group: "set",
    prompt:
      "Собери иконки для нижнего меню: главная, поиск, уведомления, профиль — в одном стиле",
    tools: ["get_matching_set"],
    set: {
      concepts: {
        главная: ["house", "home", "house-simple", "house-line", "home-2"],
        поиск: ["search", "magnifying-glass", "zoom"],
        уведомления: ["bell", "bell-simple", "bell-ringing", "notifications"],
        профиль: [
          "user",
          "user-round",
          "user-circle",
          "circle-user",
          "circle-user-round",
          "person",
          "account-circle",
          "account-box",
          "user-square",
        ],
      },
    },
    code: "any",
    license: true,
  },
  {
    id: 16,
    lang: "en",
    group: "set",
    prompt:
      "We use ph:house-bold. Add icons for settings, user and bell in the same style",
    tools: ["get_matching_set"],
    set: {
      prefix: "ph",
      suffix: "-bold",
      concepts: {
        settings: [
          "gear",
          "gear-six",
          "gear-fine",
          "sliders",
          "sliders-horizontal",
        ],
        user: ["user", "user-circle", "user-square"],
        bell: ["bell", "bell-simple", "bell-ringing", "bell-simple-ringing"],
      },
    },
    code: "any",
    license: true,
  },
  {
    id: 17,
    lang: "ru",
    group: "set",
    prompt:
      "Иконки для панели редактора текста: жирный, курсив, подчёркнутый, ссылка — из Material Symbols",
    tools: ["get_matching_set"],
    set: {
      prefix: "material-symbols",
      concepts: {
        жирный: ["format-bold"],
        курсив: ["format-italic"],
        подчёркнутый: ["format-underlined"],
        ссылка: ["link", "add-link"],
      },
    },
    code: "any",
    license: true,
  },
  {
    id: 18,
    lang: "en",
    group: "set",
    prompt:
      "Icons for a music player: play, pause, next, previous, volume — outline style",
    tools: ["get_matching_set"],
    set: {
      style: "outline",
      concepts: {
        play: [
          "play",
          "player-play",
          "play-arrow",
          "play-circle",
          "circle-play",
        ],
        pause: ["pause", "player-pause", "pause-circle", "circle-pause"],
        next: [
          "skip-forward",
          "player-skip-forward",
          "skip-next",
          "player-track-next",
          "fast-forward",
        ],
        previous: [
          "skip-back",
          "player-skip-back",
          "skip-previous",
          "player-track-prev",
          "rewind",
        ],
        volume: [
          "volume",
          "volume-1",
          "volume-2",
          "volume-up",
          "speaker-high",
          "speaker-simple-high",
        ],
      },
    },
    code: "any",
    license: true,
  },
  {
    id: 19,
    lang: "ru",
    group: "license",
    prompt:
      "Какие наборы иконок есть и можно ли их использовать в коммерческом проекте?",
    tools: ["list_sets"],
    license: true,
    answerCheck: (text) => {
      const sets = [
        "Lucide",
        "Tabler",
        "Material Symbols",
        "Phosphor",
        "Fluent",
      ].filter((name) => !text.includes(name));
      const problems = [
        sets.length > 0 ? `не названы: ${sets.join(", ")}` : "",
        has(text, /коммерч/i)
          ? ""
          : "нет ответа про коммерческое использование",
        has(text, /\bMIT\b/) && has(text, /\bISC\b/) && has(text, /Apache/)
          ? ""
          : "названы не все лицензии",
      ].filter(Boolean);
      return problems.length === 0 ? undefined : problems.join("; ");
    },
  },
  {
    id: 20,
    lang: "en",
    group: "license",
    prompt:
      "What license does the Material Symbols house icon have and how should I credit it?",
    tools: ["get_icon", "list_sets", "search_icons"],
    license: true,
    answerCheck: (text) => {
      const problems = [
        has(text, /Apache/) ? "" : "не названа Apache 2.0",
        has(text, /Google/) ? "" : "не назван Google",
        has(text, /attribution|credit|Icons: Material Symbols by Google/i)
          ? ""
          : "нет указания авторства",
      ].filter(Boolean);
      return problems.length === 0 ? undefined : problems.join("; ");
    },
  },
];
