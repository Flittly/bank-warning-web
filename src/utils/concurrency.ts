/**
 * 并发受限的批量请求工具。
 *
 * 背景（为什么必须有它）：
 * 浏览器对**同一渲染进程内同时挂起（未完成）的请求数量**有硬上限
 * （Chromium 的 kMaxOutstandingRequestsPerProcess，按挂起请求占用的私有内存计算，
 * 量级在数千个请求）。一旦超过，超出的请求会被浏览器直接拒绝，错误码为
 * net::ERR_INSUFFICIENT_RESOURCES，在 JS 侧表现为 `TypeError: Failed to fetch`。
 *
 * 关键点：这类失败**根本到不了后端**（服务端日志里查不到、数据库也不会被改动），
 * 所以很容易被误判成「后端不稳定」。凡是「一条记录一个请求」的批量操作
 * （断面校验 / 批量删除 / 批量反转等）都必须走这里限流。
 *
 * 取值参考：浏览器对同源 HTTP/1.1 只有 6 条并发连接，再调大也不会更快，
 * 只是把更多请求堆在浏览器队列里等。实测 6 并发打 700 个校验请求约 1s。
 */
export const DEFAULT_REQUEST_CONCURRENCY = 6;

/**
 * 最多同时执行 `limit` 个 worker，全部完成后按**输入顺序**返回结果。
 *
 * - `worker` 抛出的错误会中断该 worker 的循环（调用方若要求「永不抛错」，
 *   需自行在 worker 内部 try/catch 并返回失败标记）。
 * - `onProgress(done, total)` 在每次完成后调用，可用于展示进度。
 * - `items` 为空时立即返回空数组，不会启动任何 worker。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const total = items.length;
  const results: R[] = new Array(total);
  if (total === 0) return results;

  const runnerCount = Math.max(1, Math.min(Math.floor(limit) || 1, total));
  let cursor = 0;
  let done = 0;

  const runners = Array.from({ length: runnerCount }, async () => {
    while (cursor < total) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
      done += 1;
      onProgress?.(done, total);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * 判断某个错误是否为「网络层」失败——即请求根本没拿到 HTTP 响应。
 *
 * `fetch()` 被浏览器/网络栈拒绝时抛的是 TypeError（message 为 "Failed to fetch"）；
 * 后端真的返回 4xx/5xx 时抛的是普通 Error，message 形如 "500 Internal Server Error"。
 * 前者可安全重试，后者重试无意义。
 */
export function isNetworkLevelError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? '');
  return /Failed to fetch|NetworkError|Load failed|ERR_/i.test(msg);
}
