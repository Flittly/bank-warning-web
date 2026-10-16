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
 * 改为 `task-` + `crypto.randomUUID()`（UUID v4）：
 *  - 保留 `task-` 前缀维持既有可读性与链路日志习惯；
 *  - UUID v4 用 122 位随机熵，碰撞概率可忽略，且不可预测。
 */

/** 生成一个新的任务标识，形如 `task-xxxxxxxx-xxxx-...-xxxxxxxxxxxx`。 */
export function newTaskId(): string {
  return `task-${crypto.randomUUID()}`;
}
