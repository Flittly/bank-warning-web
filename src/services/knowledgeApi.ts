import { authHeaders } from '../utils/apiClient';

export interface KnowledgeDoc {
  docId: string;
  type: string;
  fileName: string;
  chunks: number;
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
  score: number;
  docId: string;
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

export async function uploadKnowledgeText(type: string, title: string, content: string): Promise<{ success: boolean; docId: string }> {
  const res = await fetch(`${BASE}/knowledge`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, title, content }),
  });
  if (!res.ok) throw new Error(`Failed to upload text: ${res.status}`);
  return res.json();
}

export async function uploadKnowledgePdf(file: File, type: string, title?: string): Promise<{ success: boolean; docId: string; chunks: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);
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
