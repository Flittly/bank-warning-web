/**
 * 同一 URL 的「在途 GET 合并」。
 *
 * <p>为什么需要：编辑器一次挂载里有两个互不相识的消费者各自拉同一份账 —
 * `EditorPage`（岸段分组下拉 / 基础参数模板）和 `ResourceSidebar`（资源树），
 * 两者都会 `GET /v0/bank/banks`（实测 184 KB）和 `GET /v0/bank/basic-params`。
 * 线上日志里这两个接口每次进页面都是 **x2**，白跑一趟还占一条同源连接。
 *
 * <p>策略刻意只做「在途合并」，**不加任何 TTL 缓存**：
 * - 请求已经发出、还没落地时，后到的调用直接复用同一个 Promise；
 * - 一旦落地，条目立刻删除 —— 下一次调用一定重新请求。
 *
 * <p>为什么不加 TTL：这两处请求都发生在同一个 React commit 的 effect 刷写里，
 * 而 `fetch` 的 Promise 至少要等到本轮宏任务结束、事件循环转一圈才可能 resolve，
 * 所以「在途」一定能覆盖住重复。加 TTL 反而会在「POST 写入后立刻重拉」这类
 * 场景下读到写前的旧数据，那是真正的正确性风险，不值得为省一次请求去赌。
 *
 * <p>返回的是**文本**而不是解析后的对象：调用方各自 `JSON.parse`，
 * 拿到的是互相独立的副本，不会因为共享同一个引用而在某一侧被就地改写。
 */

interface Inflight {
  promise: Promise<string>;
}

const inflight = new Map<string, Inflight>();

/**
 * 合并键要把「身份」算进去。
 *
 * <p>只按 URL 合并会在多用户/切号场景下把 A 的响应交给 B。
 * `Authorization` 不参与业务语义，但直接进 key 又太长，取它的轻量指纹即可
 * （这里不需要抗碰撞，只需要「不同 token 落到不同桶」）。
 */
function cacheKey(url: string, headers: Record<string, string>): string {
  const auth = headers.Authorization || headers.authorization || '';
  let fingerprint = '';
  if (auth) {
    let hash = 0;
    for (let i = 0; i < auth.length; i += 1) {
      hash = (hash * 31 + auth.charCodeAt(i)) | 0;
    }
    fingerprint = `auth:${hash >>> 0}`;
  }
  return `${url}\u0000${fingerprint}`;
}

/**
 * GET 一个 URL 并返回响应文本；相同 URL + 相同身份的并发调用只发一次网络请求。
 *
 * @throws 响应非 2xx 时抛 `Error`，并且**立刻清除在途条目**，失败不会被复用。
 */
export function sharedGetText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const key = cacheKey(url, headers);
  const hit = inflight.get(key);
  if (hit) return hit.promise;

  const promise = fetch(url, { headers })
    .then(async (res) => {
      if (!res.ok) throw new Error(`${url} ${res.status} ${res.statusText}`);
      return res.text();
    })
    .then(
      (text) => {
        inflight.delete(key);
        return text;
      },
      (err) => {
        // 失败必须删掉：否则一次网络抖动会让后续所有调用都拿到同一个 rejected Promise
        inflight.delete(key);
        throw err;
      },
    );

  inflight.set(key, { promise });
  return promise;
}

/** {@link sharedGetText} 的 JSON 版本：每个调用方各自解析，得到独立对象。 */
export async function sharedGetJSON<T = any>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const text = await sharedGetText(url, headers);
  return JSON.parse(text) as T;
}
