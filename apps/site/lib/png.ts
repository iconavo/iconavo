// PNG иконки рисует браузер (шаг 5 фазы 4, ADR-0042): SVG — картинкой по адресу data: (его пускает
// img-src CSP сайта), затем canvas нужного размера и toBlob. Сервер не нагружается.

export async function pngBlob(
  svg: string,
  width: number,
  height: number,
): Promise<Blob> {
  const image = new Image(width, height);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("canvas без 2d");
  context.drawImage(image, 0, 0, width, height);
  return await new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob === null
          ? reject(new Error("canvas не отдал PNG"))
          : resolve(blob),
      "image/png",
    ),
  );
}
