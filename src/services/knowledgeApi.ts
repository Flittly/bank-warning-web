import { authHeaders } from '../utils/apiClient';

export interface KnowledgeDoc {
  docId: string;
  type: string;
  fileName: string;
  chunks: number;
  /**
   * 实际生效的提取器。取值来自后端 `KnowledgeController` 的四个常量：
   * `inline`（文本直传）/ `docling`（PDF 结构化）/ `pypdf`（PDF 纯文本，降级）/
   * `docx-structure`（Word 结构化）。旧后端不返回时为 undefined。
   */
  extractor?: string;
  /**
   * 是否走了有损降级路径。PDF 回落 pypdf 时为 true——表格被拍平成散行、
   * 标题层级全部丢失，表现为「表里的数值搜不到」，但界面上看不出任何异常。
   */
  degraded?: boolean;
}

/** 提取器的中文说法。未收录的取值原样显示，避免新提取器在界面上变成空白。 */
const EXTRACTOR_LABELS: Record<string, string> = {
  docling: '结构化抽取',
  'docx-structure': '结构化抽取',
  pypdf: '纯文本抽取',
  inline: '文本直传',
};

export function extractorLabel(extractor?: string): string {
  if (!extractor) return '';
  return EXTRACTOR_LABELS[extractor] || extractor;
}

export interface KnowledgeDocDetail {
  success: boolean;
  docId: string;
  content: string;
  chunks: number;
  type: string;
  fileName: string;
  error?: string;
}

export interface SearchResult {
  content: string;
  /**
   * 混合检索打开后，关键词路单路命中的结果没有分数（后端返回 null）。
   * 不能当成 0 分处理，否则界面会显示「相似度 0.000」。
   */
  score: number | null;
  /** 后端显式标记这一条有没有分数，用于区分 0.000 与「根本没有分数」。 */
  scored?: boolean;
  docId: string;
  /**
   * 命中段号（1 基）与总段数。检索结果来自某一篇被切成多块的文档，
   * 只说文件名无法定位到具体位置；两项都为 null 表示后端没能确定来源位置。
   */
  chunkIndex?: number | null;
  totalChunks?: number | null;
  /** 后端拼好的来源标签（如「BMS.docx · 第 3/4 段」），优先于本地拼接。 */
  sourceLabel?: string;
}

export interface KnowledgeStats {
  store: string;
  documents: number;
  chunks: number;
  dimensions: number;
}

const BASE = '/v0/bank/ai';

export async function fetchKnowledgeList(): Promise<KnowledgeDoc[]> {
  const res = await fetch(`${BASE}/knowledge/list`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to fetch knowledge list: ${res.status}`);
  return res.json();
}

export async function fetchDocumentDetail(id: string): Promise<KnowledgeDocDetail> {
  const res = await fetch(`${BASE}/knowledge/${encodeURIComponent(id)}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to fetch document: ${res.status}`);
  return res.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${BASE}/knowledge/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to delete document: ${res.status}`);
}

export async function searchKnowledge(query: string, topK = 5): Promise<SearchResult[]> {
  const res = await fetch(`${BASE}/search?query=${encodeURIComponent(query)}&topK=${topK}`, { headers: { ...authHeaders() } });
  if (!res.ok) {
    // 阶段 1：后端会把「密钥未配置 / 无身份 / 检索失败」以 503 + error 文本返回，
    // 这里把原文带出来，前端「检索测试」区就能显示真实原因，而不是伪装成 0 条结果。
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `检索失败（HTTP ${res.status}）`);
  }
  return res.json();
}

export async function fetchKnowledgeStats(): Promise<KnowledgeStats> {
  const res = await fetch(`${BASE}/knowledge/stats`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
  return res.json();
}

export interface UploadResult {
  success: boolean;
  docId: string;
  chunks: number;
  isPublic: boolean;
  /** 真正写入向量库的段数（后端阶段 7 新增）。旧后端不返回时为 undefined。 */
  embedded?: number;
  /**
   * 嵌入失败的段数。>0 表示这一批<b>整批没有生效</b>（库中仍是上一版），
   * 不是「只有部分能被检索到」——后端按整批成功才落库的口径。
   */
  failed?: number;
  /** 实际生效的提取器与是否降级（口径同 {@link KnowledgeDoc}）。 */
  extractor?: string;
  degraded?: boolean;
  error?: string;
}

export async function uploadKnowledgeText(type: string, title: string, content: string, isPublic = false): Promise<UploadResult> {
  const res = await fetch(`${BASE}/knowledge`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, title, content, isPublic }),
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `上传失败: ${res.status}`);
  }
  return data;
}

export async function uploadKnowledgePdf(file: File, type: string, isPublic = false, title?: string): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);
  formData.append('isPublic', String(isPublic));
  if (title) formData.append('title', title);
  const res = await fetch(`${BASE}/knowledge/upload`, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `上传失败: ${res.status}`);
  }
  return data;
}
