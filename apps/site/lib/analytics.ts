// Метки аналитики (шаг 5 фазы 4, ADR-0043): копирование кода и скачивание — «успех поиска». Сервис
// аналитики без cookie подключает шаг 7; пока метка только посылает событие страницы iconavo:track —
// по нему проверка сайта видит, что метка стоит на месте. Никаких данных о человеке — только что
// скопировано или скачано.

export const TRACK_EVENT = "iconavo:track";

export type CopyWhat =
  | "tag"
  | "react"
  | "svg"
  | "css"
  | "link"
  | "install"
  | "import"
  | "script"
  | "name"
  | "attribution"
  | "icon"
  | "png";

export type SiteEvent =
  | {
      name: "copy";
      what: CopyWhat;
      icon?: string;
      /** Формат имени (lib/names.ts). */
      format?: string;
      size?: number;
    }
  | {
      name: "download";
      format: "svg" | "png" | "zip" | "sprite";
      icon?: string;
      size?: number;
      count?: number;
    };

export function track(event: SiteEvent): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent(TRACK_EVENT, { detail: event }));
}
