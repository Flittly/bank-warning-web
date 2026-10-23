/**
 * 聊天流式协议（SSE）的前端解析层。
 *
 * <p>为什么不用 `EventSource`：它只能发 GET、不能带请求体，而聊天要 POST 一大段
 * prompt（技能/任务/报告上下文）。所以这里用 `fetch` + `ReadableStream` 手工读流、
 * 自己切 SSE 帧 —— 协议本身极简单（`event:` + `data:` + 空行分隔），代价只是
 * 要自己处理"跨 chunk 的半个帧"。
 *
 * <p>后端帧协议见 `AgentController#chatStream`，两边 event 名必须一致。
 */

/** 服务端推来的一帧（原始文本层）。 */
export interface SseFrame {
  event: string;
  data: string;
}

/** 收敛后的业务事件（ChatPanel 只认这个）。 */
export type ChatStreamEvent =
  | { type: 'start'; sessionId: string }
  | { type: 'round'; round: number }
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string }
  | { type: 'tool_args'; id: string; name: string; delta: string }
  | { type: 'tool_call_end'; id: string; name: string; args: string }
  | { type: 'tool_result'; id: string; name: string; delta: string }
  | { type: 'tool_result_end'; id: string; name: string; state: string }
  | { type: 'warn'; message: string }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      success: boolean;
      data: string;
      thinking?: string;
      updatedReports?: { filename: string; updated?: string; error?: string }[];
      rejectedReports?: string[];
    };

/**
 * 从累积缓冲里切出**完整**帧，返回未被完整接收的尾部。
 *
 * <p>约定：一个帧以空行结束。所以"最后一个 \n\n 之后的内容"必须留到下次再拼，
 * 否则会把 `data: {"del` 当成一帧解析（JSON.parse 直接炸）。
 */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  // 兼容 CRLF（nginx/部分代理会改写换行）
  const text = buffer.replace(/\r\n/g, '\n');
  const blocks = text.split('\n\n');
  const rest = blocks.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const block of blocks) {
    if (!block) continue;
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue; // 空行/注释（后端心跳可能是 ": ping"）
      const idx = line.indexOf(':');
      const field = idx >= 0 ? line.slice(0, idx) : line;
      let value = idx >= 0 ? line.slice(idx + 1) : '';
      if (value.startsWith(' ')) value = value.slice(1); // 规范：冒号后允许一个空格
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
      // id / retry 用不到，忽略
    }
    if (dataLines.length === 0) continue;
    frames.push({ event, data: dataLines.join('\n') });
  }
  return { frames, rest };
}

/** 原始帧 → 业务事件；未知事件名返回 null（后端加新帧时前端不炸）。 */
export function toChatEvent(frame: SseFrame): ChatStreamEvent | null {
  let payload: Record<string, unknown>;
  try {
    payload = frame.data ? JSON.parse(frame.data) : {};
  } catch {
    return null;
  }
  const str = (key: string): string => (typeof payload[key] === 'string' ? payload[key] as string : '');
  switch (frame.event) {
    case 'start':
      return { type: 'start', sessionId: str('sessionId') };
    case 'round':
      return { type: 'round', round: Number(payload.round) || 0 };
    case 'thinking':
      return { type: 'thinking', delta: str('delta') };
    case 'text':
      return { type: 'text', delta: str('delta') };
    case 'tool_call':
      return { type: 'tool_call', id: str('id'), name: str('name') };
    case 'tool_args':
      return { type: 'tool_args', id: str('id'), name: str('name'), delta: str('delta') };
    case 'tool_call_end':
      return { type: 'tool_call_end', id: str('id'), name: str('name'), args: str('args') };
    case 'tool_result':
      return { type: 'tool_result', id: str('id'), name: str('name'), delta: str('delta') };
    case 'tool_result_end':
      return { type: 'tool_result_end', id: str('id'), name: str('name'), state: str('state') };
    case 'warn':
      return { type: 'warn', message: str('message') };
    case 'error':
      return { type: 'error', message: str('message') };
    case 'done':
      return {
        type: 'done',
        success: payload.success !== false,
        data: str('data'),
        thinking: str('thinking'),
        updatedReports: Array.isArray(payload.updatedReports)
          ? (payload.updatedReports as { filename: string; updated?: string; error?: string }[])
          : undefined,
        rejectedReports: Array.isArray(payload.rejectedReports)
          ? (payload.rejectedReports as string[])
          : undefined,
      };
    default:
      return null;
  }
}

/**
 * 发起一次流式对话，边收边回调。
 *
 * @param payload 与原 `/chat` 完全相同的请求体
 * @param onEvent 每个业务事件触发一次（可能很密集，调用方自己决定要不要合并）
 * @param signal  中止信号（点"停止"/组件卸载时 abort，服务端会因 send 失败取消订阅）
 */
export async function streamChat(
  payload: Record<string, unknown>,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/v0/bank/ai/agent/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    throw new Error(`流式接口返回 ${res.status}`);
  }
  if (!res.body) {
    throw new Error('当前浏览器不支持流式响应（ReadableStream 缺失）');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const dispatch = (flushed: string) => {
    const { frames, rest } = parseSseFrames(flushed);
    for (const frame of frames) {
      const event = toChatEvent(frame);
      if (event) onEvent(event);
    }
    return rest;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = dispatch(buffer);
  }
  // 兜底：服务端若没以空行收尾，这里把残留补完（补 \n\n 让它成为一帧）
  buffer += decoder.decode();
  if (buffer.trim()) {
    dispatch(`${buffer}\n\n`);
  }
}
