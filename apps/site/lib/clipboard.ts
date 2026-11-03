// Буфер обмена для копирования иконки (шаг 5 фазы 4): текст, который ещё готовится (рисунок иконки
// приходит из ядра не сразу), и картинка PNG. Запись — ClipboardItem прямо в обработчике щелчка, а
// данные — обещанием: Safari пускает запись в буфер только во время самого щелчка, после ожидания
// сети или canvas он бы её отклонил.

/** Текст в буфер: готовый — writeText, обещанный — ClipboardItem с обещанием. */
export async function copyText(text: string | Promise<string>): Promise<void> {
  if (typeof text === "string") {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof ClipboardItem === "undefined") {
    await navigator.clipboard.writeText(await text);
    return;
  }
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })),
    }),
  ]);
}

/** Картинка PNG в буфер. */
export async function copyPng(png: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
