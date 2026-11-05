/**
 * 任务标识（task_id）的生成工具。
 *
 * 历史实现用 `task-${Date.now()}`，存在三个问题：
 *  1. 可碰撞 —— 同一毫秒内连续创建两个任务（如批量导入断面）会得到相同 id；
 *  2. 可预测 —— 时间戳可被枚举，进而遍历/猜测他人任务；
 *  3. 无随机熵 —— 无法作为不可伪造的外部标识。
 *
 * 数据库侧 `tasks.task_id` 是 `VARCHAR(100) UNIQUE NOT NULL`（见
 * bank-model-server/docs/database_schema.sql），uuid 长度为 36，加上前缀仍在限内。
 *
 * 改为 `task-` + UUID v4：
 *  - 保留 `task-` 前缀维持既有可读性与链路日志习惯；
 *  - UUID v4 用 122 位随机熵，碰撞概率可忽略，且不可预测。
 */

/**
 * 生成一个 UUID v4 字符串。
 *
 * ⚠ 为什么不能直接写 `crypto.randomUUID()`：
 *
 *   该方法标注为 **secure context 专属**（MDN：「Secure context: This feature is
 *   available only in secure contexts」）。浏览器只在这些宿主下把页面判为安全上下文：
 *     `https://…`、`http://localhost`、`http://127.0.0.1`、`file://`
 *
 *   而本系统部署后的常规访问方式是 `http://192.168.x.x:8080` —— **明文 HTTP + 局域网 IP**，
 *   恰好落在 secure context 之外。此时 `window.crypto` 对象**依然存在**，
 *   唯独 `crypto.randomUUID` 是 `undefined`，直接调用即
 *   `TypeError: crypto.randomUUID is not a function`。
 *
 *   在「生成断面」链路里，这个调用位于创建任务之前，异常会冒泡到
 *   `generateSections` 的 catch，用户看到的就是「生成断面失败」并整条链路中断 ——
 *   断面画好了却一条都没入库。
 *
 *   降级路径改用 `crypto.getRandomValues()`：它**不受 secure context 限制**
 *   （历史上受限的只有 `crypto.subtle` 与 `crypto.randomUUID`），能取到密码学强度的
 *   随机字节，所以降级后的 UUID 依然是 122 位随机熵，
 *   「不可碰撞、不可预测」这两个性质一点没丢。
 *
 *   只有连 `getRandomValues` 都不存在（非浏览器宿主、极老的兼容层）才退到
 *   `Math.random()` —— 纯兜底，宁可随机性弱一点，也不能让「新建任务」这个主功能不可用。
 */
function uuidV4(): string {
  // 写成可选类型而不是直接用 `globalThis.crypto`：DOM lib 把它声明为必然存在的
  // `Crypto`，但真实运行时 `randomUUID` 可能缺席，`?` 才能让下面的检查有意义。
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;

  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 §4.4：第 7 字节高 4 位置为版本号 4；第 9 字节高 2 位置为变体 10xx。
  // 少了这两步，字符串长得像 UUID 但不满足 v4，正则校验/后端解析都会不认。
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}` +
    `-${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

/** 生成一个新的任务标识，形如 `task-xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`。 */
export function newTaskId(): string {
  return `task-${uuidV4()}`;
}
