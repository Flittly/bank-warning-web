/**
 * 导出文件的命名工具。
 *
 * 报告导出接口会按情况返回两种产物：
 *  - 不分幅 → `报告.docx`
 *  - 按经纬度分幅 → `报告导出包.zip`（内含 docx + 各分区断面详情 CSV）
 *
 * 两种情况的文件名由服务端 `Content-Disposition` 决定，前端不猜；只在拿不到
 * 响应头时才退回本地拼接的 docx 名。
 */

/**
 * 从 `Content-Disposition` 解析下载文件名。
 *
 * 优先取 RFC 5987 的 UTF-8 名（压缩包名通常带中文），退回 ASCII 回退名，
 * 最后用本地拼接的 docx 名兜底。
 */
export function resolveExportName(disposition: string | null, fallbackMdName: string): string {
  if (disposition) {
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
    if (encoded) {
      try {
        return decodeURIComponent(encoded[1].trim())
      } catch {
        // 编码损坏时继续尝试 ASCII 名
      }
    }
    const plain = /filename="?([^";]+)"?/i.exec(disposition)
    if (plain) return plain[1].trim()
  }
  return fallbackMdName.replace('.md', '.docx')
}

/** 响应头里的分区 CSV 个数；拿不到或非法都按 0 处理。 */
export function sectionCsvCount(headerValue: string | null): number {
  const parsed = Number(headerValue ?? '')
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/**
 * 报告正文附录里列出的导出 CSV 信息。
 *
 * 两个口径要分开，否则会把「5 个分区 + 1 个未落入分区文件」说成「6 个分区」。
 */
export interface PartitionCsvInfo {
  /** 附录里列出的**分区**个数（不含「未落入分区」与「全任务」行） */
  partitions: number
  /** 附录里列出的 CSV 文件总数（含「未落入分区」与 `风险段汇总.csv`）——与导出压缩包内的 CSV 数一致 */
  files: number
}

const EMPTY_PARTITION_CSV_INFO: PartitionCsvInfo = { partitions: 0, files: 0 }

/**
 * 附录里会随导出包一起给出的文件名。
 *
 * - `分区N_断面详情.csv` / `未落入分区_断面详情.csv`：逐断面明细，按经纬度分区；
 * - `风险段汇总.csv`：全任务连续同类风险段的汇总（位置 / 长度 km / 占比），**不分幅**，
 *   所以它在附录里以「全任务」一行出现，不能算进分区数。
 */
const isExportCsvName = (fileName: string): boolean =>
  fileName.endsWith('_断面详情.csv') || fileName === '风险段汇总.csv'

/**
 * 从报告 Markdown 正文里解析导出 CSV 清单。
 *
 * 报告末尾的附录表格每行形如
 * ```
 * | 分区 1 | 第 1 行第 1 列（经度 …，纬度 …） | 38 | `分区1_断面详情.csv` |
 * | 未落入分区 | 坐标缺失或落在自定义边界之外 | 1 | `未落入分区_断面详情.csv` |
 * | 全任务 | 连续同类风险段汇总（…） | 302 | `风险段汇总.csv` |
 * ```
 * 只认**表格行**（行首 `|`、末列是反引号文件名），避免把正文里顺带提到的名字算进来。
 *
 * <p>用途：点导出**之前**就能告诉用户「这次导出的是报告包，不是单个 docx」，
 * 而不是等下载完看到 `..._导出包.zip` 才发现。`files` 为 0 表示该报告没有任何 CSV，
 * 导出行为与历史版本一致（直接给 docx）。
 */
export function partitionCsvInfoFromReport(content: string | undefined | null): PartitionCsvInfo {
  if (!content) return EMPTY_PARTITION_CSV_INFO
  // 行首 | 首列 … | … | … | `文件名` |
  const rowRe = /^\|\s*([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|\s*`([^`\n]+)`\s*\|/gm
  const names = new Set<string>()
  let partitions = 0
  let match: RegExpExecArray | null
  while ((match = rowRe.exec(content)) !== null) {
    const fileName = match[4].trim()
    if (!isExportCsvName(fileName)) continue
    if (names.has(fileName)) continue
    names.add(fileName)
    if (/^分区\s*\d+$/.test(match[1].trim())) partitions++
  }
  return { partitions, files: names.size }
}
