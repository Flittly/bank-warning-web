/**
 * 关键词高亮切分。
 *
 * 为什么高亮放在前端而不是 SQL：
 * 1. PG 的 `ts_headline` 只对 tsvector 生效，而本项目中文根本走不了分词（整句一个 token）；
 * 2. trigram 索引只回答「整串是否出现」，不返回 token 位置；
 * 3. 用 `dangerouslySetInnerHTML` 接后端拼的 `<b>` 有 XSS 面，这里产出的是 React 节点，天然免疫。
 *
 * 复杂度只有一件事要注意：**区间必须合并**。搜「岸段 冲刷」时，
 * 「岸段冲刷」会同时命中两个词，若直接拼标签就会生成嵌套的 `<mark>`。
 */

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/** 归一化查询词：去空、转小写、去重、长词优先（长词先占位，短词就不会把它切碎） */
function normalizeTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms || []) {
    const t = String(raw ?? '').trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * 把文本切成「普通 / 命中」交替的片段。
 * 返回空数组表示没有可渲染内容；永不返回零长度片段。
 */
export function splitHighlight(text: string, terms: readonly string[]): HighlightSegment[] {
  const source = String(text ?? '');
  if (!source) return [];

  const needles = normalizeTerms(terms);
  if (needles.length === 0) return [{ text: source, hit: false }];

  const lower = source.toLowerCase();
  const ranges: Array<[number, number]> = [];

  for (const needle of needles) {
    let from = 0;
    while (from <= lower.length - needle.length) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      ranges.push([at, at + needle.length]);
      // 同一个词在文本里连续出现时不要叠加区间
      from = at + needle.length;
    }
  }

  if (ranges.length === 0) return [{ text: source, hit: false }];

  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: source.slice(cursor, start), hit: false });
    segments.push({ text: source.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), hit: false });
  return segments;
}

/** 文本是否命中任一关键词（树剪枝的 label 判定复用这一份，避免两套规则漂移） */
export function matchesAnyTerm(text: string, terms: readonly string[]): boolean {
  const source = String(text ?? '').toLowerCase();
  if (!source) return false;
  return normalizeTerms(terms).some((needle) => {
    if (!needle) return false;
    if (source.includes(needle)) return true;
    // 大写缩写（YZ / NJ / DEM）在界面上常被写成小写，反向也认一次
    return false;
  });
}
