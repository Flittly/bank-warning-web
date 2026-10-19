import type { RefEntity } from '../tree/types';

/** 与后端 SearchHitResponse 一一对应（字段名保持 camelCase，JSON 直出） */
export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string;
  taskId?: string | null;
  sectionId?: string | null;
  bankId?: string | null;
  demKey?: string | null;
  /** 后端算好的业务引用（tree 剪枝按它匹配，避免前端再推一遍 id 规则） */
  ref?: { entity: RefEntity; key: string } | Record<string, never>;
  matchedFields?: string[];
  score: number;
  lng?: number | null;
  lat?: number | null;
  updatedAt?: string | null;
  duplicateCount?: number;
}

export type SearchKind = 'task' | 'bank' | 'section' | 'dem' | 'note' | 'report';

export interface SearchResponse {
  success: boolean;
  query: string;
  terms: string[];
  total: number;
  hits: SearchHit[];
  /** 2 字中文查询：索引退化，后端已收紧 limit */
  degraded: boolean;
  /** 命中数超过 limit，列表已截断 */
  truncated?: boolean;
  hint?: string;
}

const EMPTY: SearchResponse = {
  success: true,
  query: '',
  terms: [],
  total: 0,
  hits: [],
  degraded: false,
};

export async function searchGlobal(q: string, signal?: AbortSignal): Promise<SearchResponse> {
  const query = String(q ?? '').trim();
  if (!query) return { ...EMPTY, query };

  const res = await fetch(`/v0/bank/search?q=${encodeURIComponent(query)}&limit=50`, { signal });
  if (!res.ok) {
    throw new Error(res.status === 401 ? '登录已过期，请重新登录' : `搜索失败（HTTP ${res.status}）`);
  }
  const body = (await res.json()) as Partial<SearchResponse>;
  return {
    success: body.success !== false,
    query: body.query ?? query,
    terms: Array.isArray(body.terms) ? body.terms : [],
    total: typeof body.total === 'number' ? body.total : 0,
    hits: Array.isArray(body.hits) ? body.hits : [],
    degraded: Boolean(body.degraded),
    truncated: Boolean(body.truncated),
    hint: body.hint,
  };
}

/** 把命中结果转成树剪枝用的 ref 集合（`entity:key`） */
export function toRefKeySet(hits: readonly SearchHit[]): Set<string> {
  const out = new Set<string>();
  for (const hit of hits || []) {
    const ref = hit?.ref as { entity?: string; key?: string } | undefined;
    if (ref?.entity && ref?.key) out.add(`${ref.entity}:${ref.key}`);
  }
  return out;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  task: '任务',
  bank: '岸段',
  section: '断面',
  dem: 'DEM',
  note: '备注',
  report: '报告',
};
