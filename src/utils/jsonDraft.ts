/**
 * JSON 文本域的「草稿」模型。
 *
 * 存在的理由（这是个高频复发的前端坑）：
 * 直接把 `JSON.stringify(value)` 当 textarea 的 value、在 onChange 里 `JSON.parse` 后回写 state，
 * 会让「输入 → 解析失败 → state 不变 → value 被重算回旧串」形成闭环：
 *
 *   用户删掉一个 `]`  → 文本非法 → parse 抛错 → state 没变 → React 把 value 设回旧的合法串
 *   ⇒ 这个字符根本没进输入框，光标还会跳到末尾。表现就是「JSON 框完全打不进去」。
 *
 * 另一个隐性问题是即使 parse 成功，`JSON.stringify(parsed, null, 2)` 会重新规范化缩进
 * （`1.0` → `1`、单行变多行），文本与用户敲的字符串不一致，光标位置被重置。
 *
 * 所以这里的原则是：**用户敲的文本是唯一真源，解析结果只是派生的缓存**。
 * 打字阶段永不丢弃字符；只在「失焦 / 保存」这两个明确的时机做格式化与校验。
 */

export interface JsonDraft {
  /** 用户正在编辑的原始文本 —— 唯一真源，无论是否合法都必须原样保留 */
  text: string;
  /** 语法错误描述；null 表示当前文本可解析（空文本也算可解析，语义是「用默认值」） */
  error: string | null;
  /** 是否只是「还没写完」（括号/引号未配平），用于把提示语气和真正的语法错误区分开 */
  incomplete: boolean;
}

export type JsonCommitResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/** 后端个别接口可能把 JSON 列原样当字符串返回，这里统一还原成对象，避免文本框里出现带转义的 "{\"Ky\":...}" */
function normalizeIncoming(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      // 解析不了就原样展示，让用户自己看见并修，不静默清空
      return value;
    }
  }
  return value;
}

/** 由外部数据（模板详情 / 复制自某模板）生成一份草稿 */
export function createJsonDraft(value: unknown, indent = 2): JsonDraft {
  const incoming = normalizeIncoming(value);
  let text: string;
  if (incoming === undefined || incoming === null) {
    text = '{}';
  } else {
    try {
      text = JSON.stringify(incoming, null, indent) ?? '{}';
    } catch {
      text = '{}';
    }
  }
  return { text, error: null, incomplete: false };
}

/**
 * 扫描括号与字符串状态，判断文本是否只是「尚未写完」。
 * 引号未闭合、`{`/`[` 还有剩余层数，都算未写完 —— 这时不该报「语法错误」吓人。
 */
function scanStructure(text: string): { inString: boolean; depth: number } {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
    }
  }
  return { inString, depth };
}

/** 把 JSON.parse 的英文异常翻译成「第 N 行第 M 列」，比 "Unexpected token } in JSON at position 37" 有用 */
export function describeJsonError(text: string, rawMessage: string): string {
  const match = /position (\d+)/.exec(rawMessage);
  if (!match) {
    // Chrome 有的分支只给 "Unexpected token ',', "..." is not valid JSON"，没有位置信息；
    // 这时至少给一句中文的排查方向，别让用户对着一串英文猜
    if (/Unexpected end of JSON input/i.test(rawMessage)) {
      return 'JSON 不完整（缺少结尾的 } 或 ]）';
    }
    return `${rawMessage}（请检查逗号、引号与括号是否配对）`;
  }
  const position = Math.min(Number(match[1]), text.length);
  const before = text.slice(0, position);
  const line = before.split('\n').length;
  const column = position - before.lastIndexOf('\n');
  return `第 ${line} 行第 ${column} 列附近（${rawMessage}）`;
}

/**
 * 打字：只接收文本并顺手算出「当前是否可解析」，**绝不回退文本**。
 * 这是修复「打不进去」的核心 —— 中间态非法时 text 照样保留用户敲的每一个字符。
 * 刻意做成无状态纯函数：一切从 nextText 重算，不依赖上一份 draft，避免出现两份真源。
 */
export function updateJsonDraft(nextText: string): JsonDraft {
  if (!nextText.trim()) {
    // 留空是合法语义（使用内置默认值），不报错
    return { text: nextText, error: null, incomplete: false };
  }
  try {
    JSON.parse(nextText);
    return { text: nextText, error: null, incomplete: false };
  } catch (err: any) {
    const { inString, depth } = scanStructure(nextText);
    const incomplete = inString || depth > 0;
    const message = describeJsonError(nextText, String(err?.message || err));
    return { text: nextText, error: message, incomplete };
  }
}

/**
 * 提交前校验。空文本返回 `undefined`，调用方据此走「留空 = 默认值」的分支。
 */
export function commitJsonDraft(draft: JsonDraft): JsonCommitResult {
  const text = draft.text;
  if (!text.trim()) {
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err: any) {
    return { ok: false, message: describeJsonError(text, String(err?.message || err)) };
  }
}

/**
 * 失焦时规范化（仅当文本合法）。非法时原样返回，保留用户正在写的内容。
 * 不放在 onChange 里，否则就是上面说的「光标重置」问题的另一种写法。
 */
export function formatJsonDraft(draft: JsonDraft, indent = 2): JsonDraft {
  if (!draft.text.trim() || draft.error) return draft;
  try {
    const formatted = JSON.stringify(JSON.parse(draft.text), null, indent);
    if (formatted && formatted !== draft.text) {
      return { text: formatted, error: null, incomplete: false };
    }
  } catch {
    // 理论上进不来，兜底保持原样
  }
  return draft;
}
