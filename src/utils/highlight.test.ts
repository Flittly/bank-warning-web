import { describe, expect, it } from 'vitest';
import { matchesAnyTerm, splitHighlight } from './highlight';

describe('splitHighlight', () => {
  it('无关键词时返回单段原文', () => {
    expect(splitHighlight('断面614', [])).toEqual([{ text: '断面614', hit: false }]);
  });

  it('命中中文子串并保留原文大小写', () => {
    expect(splitHighlight('长江张家港岸段', ['张家港'])).toEqual([
      { text: '长江', hit: false },
      { text: '张家港', hit: true },
      { text: '岸段', hit: false },
    ]);
  });

  it('重叠词只标一次，不产生嵌套', () => {
    const segs = splitHighlight('岸段冲刷严重', ['岸段', '岸段冲刷']);
    expect(segs.filter((s) => s.hit).length).toBe(1);
    expect(segs.find((s) => s.hit)?.text).toBe('岸段冲刷');
  });

  it('相邻区间会合并', () => {
    const segs = splitHighlight('ABCDE', ['AB', 'CD']);
    expect(segs).toEqual([
      { text: 'ABCD', hit: true },
      { text: 'E', hit: false },
    ]);
  });

  it('英文匹配忽略大小写但输出原样', () => {
    const segs = splitHighlight('tiff/YZ/2018', ['yz']);
    expect(segs.find((s) => s.hit)?.text).toBe('YZ');
  });

  it('同一词多次出现全部高亮', () => {
    const segs = splitHighlight('断面1 与 断面2', ['断面']);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['断面', '断面']);
  });

  it('未命中时整体一段', () => {
    expect(splitHighlight('岸线分析任务', ['张家港'])).toEqual([
      { text: '岸线分析任务', hit: false },
    ]);
  });

  it('空文本返回空数组', () => {
    expect(splitHighlight('', ['x'])).toEqual([]);
  });
});

describe('matchesAnyTerm', () => {
  it('命中即 true', () => {
    expect(matchesAnyTerm('bankwgs84 线段1', ['线段'])).toBe(true);
  });

  it('空词表恒 false', () => {
    expect(matchesAnyTerm('任何文本', [])).toBe(false);
    expect(matchesAnyTerm('任何文本', ['  '])).toBe(false);
  });
});
