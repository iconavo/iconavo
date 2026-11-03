// Скачивание файла из браузера (шаг 5 фазы 4, ADR-0042): файл собирается на странице, без запроса к
// серверу, — Blob и ссылка с download. Адрес blob: живёт минуту: браузеру хватает, чтобы начать
// скачивание, и память не копится.

export function saveFile(name: string, data: Blob | string, type: string) {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
