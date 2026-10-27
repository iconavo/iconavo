// Скрипт страницы «Тег» (фаза 3, шаг 5): работает в браузере, не в Node. Порядок важен: сначала через
// ядро — хосты режима и свой набор slow для заглушек, затем скрипт для страниц без сборщика: он
// регистрирует тег, и теги страницы начинают грузиться уже с хостами режима. Последней — копия «как у
// сборщика» через import map: регистрацию она пропускает, хранилище у копий общее. Разметку скрипт
// не пишет — только DOM: строгая политика Trusted Types страницы иначе его остановила бы.

import { configure, setLoader } from "@iconavo-ui/core";
import type { TagData } from "./tag-page.js";

const data = JSON.parse(
  document.getElementById("tag-data")?.textContent ?? "{}",
) as TagData;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

// Ошибки и нарушения политики — с самого начала.
const problems: string[] = [];
const note = (text: string) => {
  problems.push(text);
  $("diag-problems").textContent = problems.join("; ");
};
addEventListener("error", (e) => note(`ошибка: ${e.message}`));
addEventListener("securitypolicyviolation", (e) =>
  note(`CSP: ${e.violatedDirective}${e.blockedURI ? ` ${e.blockedURI}` : ""}`),
);

// Сколько раз пакет просил политику Trusted Types: копий две, политика должна быть одна.
let requested = 0;
const factory = (
  globalThis as { trustedTypes?: { createPolicy(...args: unknown[]): unknown } }
).trustedTypes;
if (factory) {
  const create = factory.createPolicy.bind(factory);
  factory.createPolicy = (...args: unknown[]) => {
    requested++;
    return create(...args);
  };
}

configure({
  api: data.hosts.filter((h) => h.kind === "api").map((h) => h.url),
  cdn: data.hosts.filter((h) => h.kind === "cdn").map((h) => h.url),
});

// Свой набор slow: любая иконка — круг с галочкой, через выбранную задержку.
let delay = data.delays.at(-1) ?? 0;
const delayButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("button[data-delay]"),
];
for (const button of delayButtons) {
  button.onclick = () => {
    delay = Number(button.dataset.delay);
    for (const b of delayButtons) {
      b.setAttribute("aria-pressed", String(b === button));
    }
  };
}
const BODY =
  '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" stroke-width="2"/>';
setLoader(
  "slow",
  (names) =>
    new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            prefix: "slow",
            width: 24,
            height: 24,
            icons: Object.fromEntries(
              names.map((name) => [name, { body: BODY }]),
            ),
          }),
        delay,
      );
    }),
);

// Первая копия — скрипт для страниц без сборщика; адрес — строкой, чтобы tsc его не искал.
const standalone: string = "/icon/iconavo-icon.js";
await import(standalone);
const tag = customElements.get("iconavo-icon");
$("diag-first").textContent = tag
  ? `скрипт для страниц без сборщика ${standalone} — он загрузился первым`
  : "никто — тег не зарегистрирован";
try {
  await import("@iconavo-ui/icon");
  $("diag-second").textContent =
    customElements.get("iconavo-icon") === tag
      ? "загрузилась без ошибок и регистрацию пропустила"
      : "зарегистрировала тег заново — ошибка";
} catch (e) {
  $("diag-second").textContent = `ошибка: ${(e as Error).message}`;
}

/** Политика Trusted Types пакета: одна на страницу, под общим ключом. */
function showPolicy(): void {
  const policy = (
    globalThis as unknown as Record<
      symbol,
      { name?: string } | null | undefined
    >
  )[Symbol.for("iconavo.trusted-types")];
  $("diag-policy").textContent =
    policy === undefined
      ? "ещё не создана"
      : policy === null
        ? `не разрешена или Trusted Types нет; запросов ${requested}`
        : `«${policy.name}», запросов на создание — ${requested}`;
}
setInterval(showPolicy, 1000);

// Заглушки: каждый показ — новые имена, иначе иконки взялись бы из памяти страницы.
const KINDS = ["skeleton", "spinner", "none"] as const;
let run = 0;
function showPlaceholders(): void {
  run++;
  const figures: HTMLElement[] = [];
  for (const dark of [false, true]) {
    for (const kind of KINDS) {
      for (const size of [16, 24, 48]) {
        const icon = document.createElement("iconavo-icon");
        icon.setAttribute("icon", `slow:r${run}-${figures.length}`);
        if (kind !== "skeleton") icon.setAttribute("placeholder", kind);
        const stage = document.createElement("div");
        stage.className = `stage size-${size}${dark ? " dark" : ""}`;
        stage.append(icon, " Аа");
        const caption = document.createElement("figcaption");
        caption.textContent = `${kind === "skeleton" ? "skeleton — по умолчанию" : kind}, ${size} px${dark ? ", тёмный фон" : ""}`;
        const figure = document.createElement("figure");
        figure.className = "cell";
        figure.append(stage, caption);
        figures.push(figure);
      }
    }
  }
  $("placeholder-cells").replaceChildren(...figures);
}
showPlaceholders();
$<HTMLButtonElement>("again").onclick = showPlaceholders;

// Режим разработки: перерисовать иконки, которых нет, — тот же атрибут ещё раз.
function redrawMissing(): void {
  for (const icon of $("missing-cells").querySelectorAll("iconavo-icon")) {
    icon.setAttribute("icon", icon.getAttribute("icon") ?? "");
  }
}
$<HTMLButtonElement>("dev-on").onclick = () => {
  configure({ dev: true });
  redrawMissing();
};
$<HTMLButtonElement>("dev-off").onclick = () => {
  configure({ dev: false });
  redrawMissing();
};

// Цвет текста — свойством стиля из скрипта: его строгая политика не запрещает.
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "button[data-color]",
)) {
  button.onclick = () => {
    $("recolor").style.color = button.dataset.color ?? "";
  };
}

$("status").textContent =
  "Готово. Иконки грузятся, когда подходят к видимой части страницы.";
document.body.dataset.ready = "1";
