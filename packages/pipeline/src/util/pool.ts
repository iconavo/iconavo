// Ограничение параллельности: до limit задач одновременно. Так ходят к Polza (векторы, судья) и
// пишут десятки тысяч файлов раздачи.

/** До limit задач одновременно; задача сама ловит свои ошибки. */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++] as T);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}
