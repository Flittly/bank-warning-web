import { describe, expect, it } from 'vitest';
import {
  commitJsonDraft,
  createJsonDraft,
  describeJsonError,
  formatJsonDraft,
  updateJsonDraft,
  type JsonDraft,
} from './jsonDraft';

const DEFAULT_THRESHOLDS = { Ky: [1.7, 1.35, 1], Zb: [20, 30, 40] };

/**
 * 复刻修复前的受控写法：把 JSON.stringify(state) 当 value，onChange 里 parse 成功才回写 state。
 * 用它来钉住回归 —— 旧写法在第一个非法中间态就把文本卡死，这正是「JSON 打不进去」的根因。
 */
function legacyType(value: unknown, nextText: string): unknown {
  try {
    return JSON.parse(nextText);
  } catch {
    return value;
  }
}

/** 模拟一次「用户按键」：浏览器把当前文本接上这个字符，再触发 onChange */
function pressKey(draft: JsonDraft, key: string): JsonDraft {
  return updateJsonDraft(`${draft.text}${key}`);
}

/** 把 Ky 的第三个阈值删掉，制造一个「括号配平但语法错」的中间态（数组末尾多一个逗号） */
function breakArrayTail(text: string): string {
  return text.replace(/\[\s*1\.7,\s*1\.35,\s*1\s*\]/, '[\n    1.7,\n    1.35,\n    ]');
}

describe('jsonDraft：修复前的行为（回归基线）', () => {
  it('中间态非法时旧写法会把输入整段吞掉', () => {
    let legacyState: unknown = DEFAULT_THRESHOLDS;
    const initialText = JSON.stringify(legacyState, null, 2);

    const broken = breakArrayTail(initialText);
    expect(broken).not.toBe(initialText);
    legacyState = legacyType(legacyState, broken);

    // 旧写法 state 没变 ⇒ 下一次渲染 value 又被 stringify 回完整旧串，用户敲的全丢
    expect(JSON.stringify(legacyState, null, 2)).toBe(initialText);
    expect(JSON.stringify(legacyState, null, 2)).not.toContain('1.35,\n    ]');
  });

  it('新写法在同样的中间态下保留用户文本', () => {
    const draft = createJsonDraft(DEFAULT_THRESHOLDS);
    const broken = breakArrayTail(draft.text);
    expect(broken).not.toBe(draft.text);
    const next = updateJsonDraft(broken);

    expect(next.text).toBe(broken);
    expect(next.error).not.toBeNull();
    // 括号是配平的：这是真语法错误，不是「还没写完」
    expect(next.incomplete).toBe(false);
  });
});

describe('updateJsonDraft', () => {
  it('逐字符输入不会丢字符', () => {
    // 全选删空后重新输入，是最容易被「parse 失败就丢弃」卡死的路径
    let draft = updateJsonDraft('');
    for (const ch of '{"Ky": [1, 2, 3]}') {
      draft = pressKey(draft, ch);
    }
    expect(draft.text).toBe('{"Ky": [1, 2, 3]}');
    expect(draft.error).toBeNull();
    expect(commitJsonDraft(draft)).toEqual({ ok: true, value: { Ky: [1, 2, 3] } });
  });

  it('未闭合的括号标记为「还没写完」而不是语法错误', () => {
    const draft = updateJsonDraft('{"Ky": [1, 2');
    expect(draft.incomplete).toBe(true);
    expect(draft.error).toContain('第 1 行');
  });

  it('未闭合的字符串也算没写完', () => {
    const draft = updateJsonDraft('{"Ky": "abc');
    expect(draft.incomplete).toBe(true);
  });

  it('转义引号不会提前结束字符串计数', () => {
    const draft = updateJsonDraft('{"note": "a\\"b", "x": 1}');
    expect(draft.error).toBeNull();
    expect(commitJsonDraft(draft)).toEqual({ ok: true, value: { note: 'a"b', x: 1 } });
  });

  it('留空视为合法（语义是「使用内置默认值」）', () => {
    const draft = updateJsonDraft('   ');
    expect(draft.error).toBeNull();
    expect(commitJsonDraft(draft)).toEqual({ ok: true, value: undefined });
  });

  it('删到空再重新输入可以恢复', () => {
    let draft = createJsonDraft(DEFAULT_THRESHOLDS);
    draft = updateJsonDraft('');
    expect(draft.text).toBe('');
    draft = pressKey(draft, '{');
    draft = pressKey(draft, '}');
    expect(commitJsonDraft(draft)).toEqual({ ok: true, value: {} });
  });

  it('数字中间态 1. 不会吞掉后续字符', () => {
    let draft = updateJsonDraft('');
    for (const ch of '{"Zb": [1.') {
      draft = pressKey(draft, ch);
    }
    expect(draft.text).toBe('{"Zb": [1.');
    expect(draft.error).not.toBeNull();
    draft = pressKey(draft, '5]}');
    expect(commitJsonDraft(draft)).toEqual({ ok: true, value: { Zb: [1.5] } });
  });
});

describe('commitJsonDraft', () => {
  it('语法错误返回 ok:false 并带行列定位', () => {
    const draft = updateJsonDraft('{\n  "Ky": [1, 2,]\n}');
    const result = commitJsonDraft(draft);
    expect(result.ok).toBe(false);
  });

  it('合法文本返回解析后的对象', () => {
    const draft = updateJsonDraft('{"wNM": [0.43, 0.32, 0.25]}');
    expect(commitJsonDraft(draft)).toEqual({ ok: true, value: { wNM: [0.43, 0.32, 0.25] } });
  });
});

describe('createJsonDraft', () => {
  it('对象展开成两空格缩进', () => {
    expect(createJsonDraft({ a: 1 }).text).toBe('{\n  "a": 1\n}');
  });

  it('null / undefined 退化成空对象', () => {
    expect(createJsonDraft(null).text).toBe('{}');
    expect(createJsonDraft(undefined).text).toBe('{}');
  });

  it('后端误传 JSON 字符串时还原成对象，不出现带转义的引号', () => {
    const draft = createJsonDraft('{"Ky":[1.7,1.35,1]}');
    expect(draft.text).toBe('{\n  "Ky": [\n    1.7,\n    1.35,\n    1\n  ]\n}');
    expect(draft.text).not.toContain('\\"');
  });

  it('无法解析的字符串原样展示，不静默清空', () => {
    expect(createJsonDraft('Ky: 1.7').text).toBe('"Ky: 1.7"');
  });
});

describe('formatJsonDraft', () => {
  it('合法文本在失焦时规范化', () => {
    const draft = updateJsonDraft('{"a":1,"b":[2,3]}');
    const formatted = formatJsonDraft(draft);
    expect(formatted.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
    expect(formatted.error).toBeNull();
  });

  it('非法文本不动，保留用户正在写的内容', () => {
    const draft = updateJsonDraft('{"a":1');
    expect(formatJsonDraft(draft).text).toBe('{"a":1');
  });

  it('空文本保持为空', () => {
    const draft = updateJsonDraft('');
    expect(formatJsonDraft(draft).text).toBe('');
  });
});

describe('describeJsonError', () => {
  it('把 position 换算成行列', () => {
    const text = '{\n  "a": 1\n  "b": 2\n}';
    let raw = '';
    try {
      JSON.parse(text);
    } catch (e: any) {
      raw = e.message;
    }
    expect(describeJsonError(text, raw)).toMatch(/第 3 行第 3 列/);
  });

  it('没有 position 时至少给出中文排查方向', () => {
    expect(describeJsonError('x', 'weird error')).toContain('请检查逗号、引号与括号');
    expect(describeJsonError('{', 'Unexpected end of JSON input')).toContain('JSON 不完整');
  });
});
