import { describe, expect, it } from 'vitest';
import { parseSseFrames, toChatEvent } from './chatStream';

describe('parseSseFrames', () => {
  it('切出完整帧，并保留未收全的尾部', () => {
    const { frames, rest } = parseSseFrames('event: text\ndata: {"delta":"你好"}\n\nevent: text\ndata: {"del');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ event: 'text', data: '{"delta":"你好"}' });
    // 半个帧不能被解析，否则 JSON.parse 会炸
    expect(rest).toBe('event: text\ndata: {"del');
  });

  it('跨 chunk 拼接后能正确解析', () => {
    const first = parseSseFrames('event: text\ndata: {"delta":"你');
    expect(first.frames).toHaveLength(0);
    const second = parseSseFrames(`${first.rest}好"}\n\n`);
    expect(second.frames).toEqual([{ event: 'text', data: '{"delta":"你好"}' }]);
    expect(second.rest).toBe('');
  });

  it('多行 data 用换行拼接', () => {
    const { frames } = parseSseFrames('event: text\ndata: a\ndata: b\n\n');
    expect(frames[0].data).toBe('a\nb');
  });

  it('忽略注释行与空行，缺省事件名为 message', () => {
    const { frames } = parseSseFrames(': ping\n\ndata: {"delta":"x"}\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ event: 'message', data: '{"delta":"x"}' });
  });

  it('兼容 CRLF 换行', () => {
    const { frames } = parseSseFrames('event: text\r\ndata: {"delta":"x"}\r\n\r\n');
    expect(frames[0]).toEqual({ event: 'text', data: '{"delta":"x"}' });
  });

  it('没有 data 的块直接丢弃', () => {
    const { frames } = parseSseFrames('event: text\n\n');
    expect(frames).toHaveLength(0);
  });
});

describe('toChatEvent', () => {
  it('映射正文增量', () => {
    expect(toChatEvent({ event: 'text', data: '{"delta":"abc"}' }))
      .toEqual({ type: 'text', delta: 'abc' });
  });

  it('映射工具调用与结果', () => {
    expect(toChatEvent({ event: 'tool_call', data: '{"id":"t1","name":"query_risk"}' }))
      .toEqual({ type: 'tool_call', id: 't1', name: 'query_risk' });
    expect(toChatEvent({ event: 'tool_result_end', data: '{"id":"t1","name":"query_risk","state":"SUCCESS"}' }))
      .toEqual({ type: 'tool_result_end', id: 't1', name: 'query_risk', state: 'SUCCESS' });
  });

  it('done 帧带最终正文与报告改写结果', () => {
    const event = toChatEvent({
      event: 'done',
      data: JSON.stringify({
        success: true,
        data: '最终答复',
        thinking: '推理',
        updatedReports: [{ filename: 'r.md', updated: 'true' }],
      }),
    });
    expect(event).toMatchObject({
      type: 'done',
      success: true,
      data: '最终答复',
      thinking: '推理',
      updatedReports: [{ filename: 'r.md', updated: 'true' }],
    });
  });

  it('未知事件名与坏 JSON 返回 null（不抛错）', () => {
    expect(toChatEvent({ event: 'something_new', data: '{}' })).toBeNull();
    expect(toChatEvent({ event: 'text', data: 'not-json' })).toBeNull();
  });
});
