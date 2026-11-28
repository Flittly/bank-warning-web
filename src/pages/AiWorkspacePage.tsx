import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { message as antdMessage } from 'antd';
import {
  ArrowLeft,
  Bot,
  Brain,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react';
import { getStoredAiModel, onAiModelChanged, setStoredAiModel } from '../utils/aiModelSettings';
import { streamChat, type ChatStreamEvent } from '../utils/chatStream';
import styles from './AiWorkspacePage.module.css';

/**
 * AI 分析助手：占满内容区的**独立页面**（路由 `/editor/ai`），不是弹窗。
 *
 * <p>为什么不是复用右侧那根 `ChatPanel`：那是"贴着地图的窄侧栏"，会话只能塞进一个
 * 原生 `<select>`，看不到历史、也没法给会话起名。这一页要的是 WorkBuddy 那种
 * 「左边一列会话记录、右边一整块对话区」的形态，两者布局约束完全不同，故独立实现；
 * 后端接口与流式协议完全共用（`/v0/bank/ai/chat/*` + `streamChat`），会话是同一份。
 *
 * <p>会话采用**懒创建**：点「新对话」只清空界面，直到真的发出第一条消息才建库，
 * 标题取问题前 30 字 —— 否则每点一次「新对话」就在列表里留一条 "会话-xxxxxxxx" 的空壳。
 */

interface ChatSession {
  session_id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
}

interface ChatToolCall {
  id: string;
  name: string;
  args: string;
  result: string;
  status: 'running' | 'done';
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  contextText?: string;
  thinking?: string;
  tools?: ChatToolCall[];
  streaming?: boolean;
}

const MAX_TITLE = 30;

/** 会话列表里的时间：今天只给时:分，往前给月-日。 */
function formatTime(raw?: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return sameDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function AiWorkspacePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 从编辑器跳过来时带上的任务 id（`/editor/ai?taskId=…`）：只作为对话上下文，
  // 工具层据此取数；页面本身不锁任务，用户仍可在对话里问别的。
  const contextTaskId = searchParams.get('taskId');
  const contextTask = contextTaskId ? { taskId: contextTaskId } : null;

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<{ key: string; label: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState(() => getStoredAiModel());

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // 当前会话 id 的镜像：打开弹窗的 effect 只想跑一次（[open]），不能把 activeSessionId
  // 写进依赖，否则每切一次会话都会重拉列表、把正在看的对话重置回第一条。
  const activeSessionIdRef = useRef<string | null>(null);
  // 流式令牌：切会话 / 停止 / 关闭弹窗后，在途帧一律丢弃
  const streamTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // 用户往上翻历史时不要被"自动滚到底"打断
  const stickToBottomRef = useRef(true);

  const scrollToBottom = useCallback((smooth = false) => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
  }, []);

  /** 切会话的唯一入口：同步 state 与 ref（ref 供只依赖 [open] 的 effect 读）。 */
  const applySessionId = useCallback((id: string | null) => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
  }, []);

  const stopStreaming = useCallback(() => {
    streamTokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'assistant' || !last.streaming) return prev;
      const next = prev.slice();
      next[next.length - 1] = {
        ...last,
        streaming: false,
        content: last.content ? `${last.content}\n\n（已停止）` : '（已停止）',
      };
      return next;
    });
  }, []);

  const fetchMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/v0/bank/ai/chat/sessions/${sessionId}/messages`);
      const data = await res.json();
      if (data?.success && Array.isArray(data.messages)) {
        setMessages(data.messages);
        requestAnimationFrame(() => scrollToBottom());
      }
    } catch {
      /* 拉不到历史就保持空态，不打断当前操作 */
    }
  }, [scrollToBottom]);

  const fetchSessions = useCallback(async (): Promise<ChatSession[]> => {
    try {
      const res = await fetch('/v0/bank/ai/chat/sessions');
      const data = await res.json();
      if (!data?.success || !Array.isArray(data.sessions)) return [];
      setSessions(data.sessions);
      return data.sessions;
    } catch {
      return [];
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/v0/bank/ai/models');
      const data = await res.json();
      if (!data?.success || !Array.isArray(data.models) || data.models.length === 0) return;
      const list: { key: string; label: string }[] = data.models;
      setModels(list);
      const stored = getStoredAiModel();
      const next = stored && list.some((m) => m.key === stored) ? stored : list[0].key;
      setSelectedModel(next);
      setStoredAiModel(next);
    } catch {
      /* 没配模型时不显示下拉，发送时后端会给出明确报错 */
    }
  }, []);

  // 进页面即载入：会话列表 + 模型列表；上次选中的会话还在就接着聊，否则落到最近一条。
  // 刻意只跑一次：切会话不该触发这里（见 activeSessionIdRef 的注释）。
  useEffect(() => {
    void fetchModels();
    void (async () => {
      const list = await fetchSessions();
      if (list.length === 0) {
        setMessages([]);
        return;
      }
      const keep = activeSessionIdRef.current && list.some((s) => s.session_id === activeSessionIdRef.current)
        ? activeSessionIdRef.current
        : list[0].session_id;
      applySessionId(keep);
      void fetchMessages(keep);
    })();
  }, [fetchModels, fetchSessions, fetchMessages, applySessionId]);

  useEffect(
    () =>
      onAiModelChanged((key) => {
        if (key) setSelectedModel(key);
      }),
    [],
  );

  // 进页面就把焦点交给输入框（和聊天工具一致，进来就能打字）
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  // 离开页面时中断在途流：组件已卸载，帧回调不该再往 state 里写
  useEffect(
    () => () => {
      streamTokenRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const patchLast = (token: number, fn: (m: ChatMessage) => ChatMessage) => {
    if (streamTokenRef.current !== token) return;
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'assistant') return prev;
      const next = prev.slice();
      next[next.length - 1] = fn({ ...last });
      return next;
    });
  };

  const saveChatMessage = async (
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    contextText?: string,
  ) => {
    try {
      await fetch(`/v0/bank/ai/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content, contextText: contextText || '' }),
      });
    } catch {
      /* 存历史失败不影响本轮对话 */
    }
  };

  /** 懒创建会话：标题取问题前 30 字，避免列表里出现一堆 "会话-xxxxxxxx" 空壳。 */
  const ensureSession = async (question: string): Promise<string | null> => {
    if (activeSessionId) return activeSessionId;
    const title = question.length > MAX_TITLE ? `${question.slice(0, MAX_TITLE)}…` : question;
    try {
      const res = await fetch('/v0/bank/ai/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (!data?.success || !data.session_id) throw new Error(data?.error || '创建会话失败');
      applySessionId(data.session_id);
      setSessions((prev) => [
        { session_id: data.session_id, title, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ...prev,
      ]);
      return data.session_id as string;
    } catch (e) {
      antdMessage.error(`无法创建会话：${(e as Error).message}`, 4);
      return null;
    }
  };

  const sendMessage = async () => {
    const question = input.trim();
    if (!question || loading) return;

    setInput('');
    stickToBottomRef.current = true;
    const contextText = contextTask ? `📋 ${contextTask.taskId}` : undefined;
    setMessages((prev) => [...prev, { role: 'user', content: question, contextText }]);

    const sessionId = await ensureSession(question);
    if (!sessionId) {
      setMessages((prev) => prev.slice(0, -1));
      setInput(question);
      return;
    }
    await saveChatMessage(sessionId, 'user', question, contextText);
    // 乐观置顶：后端 session 表的 updated_at 要在下一次重启后才随消息刷新，
    // 本地先把这条会话挪到「最近」第一位，界面顺序不依赖后端是否已更新。
    setSessions((prev) => {
      const hit = prev.find((x) => x.session_id === sessionId);
      if (!hit) return prev;
      return [{ ...hit, updated_at: new Date().toISOString() }, ...prev.filter((x) => x.session_id !== sessionId)];
    });

    const token = streamTokenRef.current + 1;
    streamTokenRef.current = token;
    const abort = new AbortController();
    abortRef.current = abort;
    setLoading(true);
    setMessages((prev) => [...prev, { role: 'assistant', content: '', thinking: '', tools: [], streaming: true }]);

    let finalText = '';
    try {
      await streamChat(
        {
          question,
          sessionId,
          skills: [],
          taskIds: contextTask ? [contextTask.taskId] : [],
          reportIds: [],
          model: selectedModel,
        },
        (event: ChatStreamEvent) => {
          switch (event.type) {
            case 'thinking':
              patchLast(token, (m) => ({ ...m, thinking: `${m.thinking || ''}${event.delta}` }));
              break;
            case 'text':
              patchLast(token, (m) => ({ ...m, content: `${m.content}${event.delta}` }));
              break;
            case 'tool_call':
              patchLast(token, (m) => ({
                ...m,
                tools: [...(m.tools || []), { id: event.id, name: event.name, args: '', result: '', status: 'running' }],
              }));
              break;
            case 'tool_args':
              patchLast(token, (m) => ({
                ...m,
                tools: (m.tools || []).map((t) => (t.id === event.id ? { ...t, args: t.args + event.delta } : t)),
              }));
              break;
            case 'tool_call_end':
              patchLast(token, (m) => ({
                ...m,
                tools: (m.tools || []).map((t) => (t.id === event.id ? { ...t, args: event.args || t.args } : t)),
              }));
              break;
            case 'tool_result':
              // 只留尾部 1200 字：工具结果可能上万字，全量塞进状态会拖垮渲染
              patchLast(token, (m) => ({
                ...m,
                tools: (m.tools || []).map((t) =>
                  t.id === event.id ? { ...t, result: `${t.result}${event.delta}`.slice(-1200) } : t,
                ),
              }));
              break;
            case 'tool_result_end':
              patchLast(token, (m) => ({
                ...m,
                tools: (m.tools || []).map((t) => (t.id === event.id ? { ...t, status: 'done' } : t)),
              }));
              break;
            case 'warn':
              patchLast(token, (m) => ({
                ...m,
                content: `${m.content}${m.content ? '\n\n' : ''}⚠ ${event.message}`,
              }));
              break;
            case 'error':
              patchLast(token, (m) => ({ ...m, streaming: false, content: m.content || `⚠ ${event.message}` }));
              break;
            case 'done':
              finalText = event.data || '';
              patchLast(token, (m) => ({
                ...m,
                streaming: false,
                content: event.data || m.content,
                thinking: event.thinking || m.thinking,
              }));
              break;
            default:
              break; // start / round 不上屏
          }
        },
        abort.signal,
      );
      if (finalText && streamTokenRef.current === token) {
        await saveChatMessage(sessionId, 'assistant', finalText);
        void fetchSessions();
      }
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      patchLast(token, (m) => ({
        ...m,
        streaming: false,
        content: m.content || (aborted ? '（已停止）' : '网络错误，请检查后端服务。'),
      }));
    } finally {
      if (streamTokenRef.current === token) setLoading(false);
      abortRef.current = null;
    }
  };

  const startNewChat = () => {
    if (loading) stopStreaming();
    applySessionId(null);
    setMessages([]);
    setInput('');
    stickToBottomRef.current = true;
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const switchSession = (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    if (loading) stopStreaming();
    applySessionId(sessionId);
    setMessages([]);
    stickToBottomRef.current = true;
    void fetchMessages(sessionId);
  };

  const deleteSession = async (sessionId: string) => {
    if (!window.confirm('确定删除此会话？删除后聊天记录不可恢复。')) return;
    try {
      await fetch(`/v0/bank/ai/chat/sessions/${sessionId}`, { method: 'DELETE' });
      const list = await fetchSessions();
      if (activeSessionId === sessionId) {
        if (list.length > 0) {
          applySessionId(list[0].session_id);
          void fetchMessages(list[0].session_id);
        } else {
          applySessionId(null);
          setMessages([]);
        }
      }
    } catch {
      antdMessage.error('删除会话失败', 3);
    }
  };

  const activeTitle = sessions.find((s) => s.session_id === activeSessionId)?.title || '新对话';

  return (
    <div className={styles.page} aria-label="AI 分析助手">
      {/* 左栏：会话记录 */}
      <aside className={styles.sidebar}>
        {/* 标题行与「断面编辑器」「任务列表」左栏同一套：复用全局 `.sidebar-header`
            （14px 线性图标 + h4 / 0.85rem / 600 / #475569）。
            这里不另做 26px 渐变圆角方块的品牌头：三处左栏并排看是一列纵栏，
            标题行高度、字号、图标笔触必须一致，否则像换了套外壳。
            上下文来源不必写在这（右栏顶部已有「← 返回断面编辑器」）。 */}
        <div
          className="sidebar-header"
          data-tour="ai-header"
          style={{ padding: '12px 14px 8px', margin: 0, flexShrink: 0 }}
        >
          <Bot size={14} />
          <h4>AI 分析助手</h4>
        </div>

        <button type="button" className={styles.newChatBtn} onClick={startNewChat}>
          <Plus size={15} /> 新对话
        </button>

          <div className={styles.listScroll}>
            <div className={styles.groupLabel}>最近会话</div>
            {sessions.length === 0 && (
              <div className={styles.sidebarEmpty}>还没有会话。直接提问，第一条消息会自动成为一个新会话。</div>
            )}
            {sessions.map((s) => (
              // 容器不能用 <button>：里面还有一个「删除」按钮，按钮嵌按钮是无效 HTML，
              // 键盘与读屏器都会选不中里层那个。用 div[role=button] + 显式键处理替代。
              <div
                key={s.session_id}
                role="button"
                tabIndex={0}
                className={`${styles.sessionItem} ${s.session_id === activeSessionId ? styles.sessionItemActive : ''}`}
                onClick={() => switchSession(s.session_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    switchSession(s.session_id);
                  }
                }}
                title={s.title}
              >
                <span className={styles.sessionTitle}>{s.title}</span>
                <span className={styles.sessionMeta}>{formatTime(s.updated_at || s.created_at)}</span>
                <button
                  type="button"
                  className={styles.sessionDelete}
                  title="删除会话"
                  aria-label={`删除会话 ${s.title}`}
                  onClick={(e) => { e.stopPropagation(); void deleteSession(s.session_id); }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          <div className={styles.sidebarFooter}>
            <select
              className={styles.modelSelect}
              value={selectedModel}
              onChange={(e) => { setSelectedModel(e.target.value); setStoredAiModel(e.target.value); }}
              title="选择模型"
            >
              {models.length === 0 && <option value="">未配置模型</option>}
              {models.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
        </aside>

        {/* 右栏：对话区 */}
        <div className={styles.main}>
          <div className={styles.header}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => navigate('/editor')}
              title="返回断面编辑器"
            >
              <ArrowLeft size={15} /> 返回断面编辑器
            </button>
            <span className={styles.headerSep} />
            <span className={styles.headerTitle}>{activeTitle}</span>
            {contextTask && (
              <span className={styles.headerBadge}>📋 {contextTask.taskId}</span>
            )}
            <div className={styles.headerActions}>
              <button type="button" className={styles.iconBtn} onClick={startNewChat} title="新对话">
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className={styles.thread} ref={threadRef} onScroll={onThreadScroll}>
            <div className={styles.threadInner}>
              {messages.length === 0 && (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon}><Sparkles size={24} /></span>
                  <h3 className={styles.emptyTitle}>在这一步问 AI 最省事</h3>
                  <p className={styles.emptyDesc}>
                    选岸段、配参数、出断面之后，为什么某条断面被标成无效、这个任务的报告该看哪几张图，
                    都可以直接问。回答仅供参考，是否采用仍由你判断。
                  </p>
                  <div className={styles.suggestions}>
                    {[
                      '我选中的这些岸段，风险等级为什么不一样？',
                      '这个任务里无效断面的原因分别是什么？',
                      '帮我解读最近一次报告里的图，重点看哪几段？',
                    ].map((q) => (
                      <button
                        key={q}
                        type="button"
                        className={styles.suggestion}
                        onClick={() => { setInput(q); inputRef.current?.focus(); }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={styles.msg}>
                  {m.role === 'user' ? (
                    <div className={styles.msgUser}>
                      <div>
                        {m.contextText && <div className={styles.userContext}>{m.contextText}</div>}
                        <div className={styles.userBubble}>{m.content}</div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={styles.aiHead}>
                        <Sparkles size={13} /> AI 助手
                      </div>
                      {m.thinking && <ThinkingTrace text={m.thinking} streaming={!!m.streaming} />}
                      {m.tools && m.tools.length > 0 && <ToolTrace tools={m.tools} />}
                      {m.streaming || !m.content ? (
                        <div className={styles.aiBody}>
                          {m.content || <span className={styles.aiPlaceholder}>正在生成…</span>}
                          {m.streaming && m.content && <span className={styles.caret}>▍</span>}
                        </div>
                      ) : (
                        // 流式期间走纯文本（每帧重解析 markdown 会卡），结束后再整体渲染：
                        // 模型回复里大量 `| 项目 | 内容 |` 表格，纯文本读起来像乱码。
                        <div className={`${styles.aiBody} ${styles.md}`}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </div>

          <div className={styles.composerWrap}>
            <div className={styles.composerInner}>
              <div className={styles.composer}>
                <textarea
                  ref={inputRef}
                  className={styles.textarea}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="描述你的问题，或让 AI 解释当前断面 / 任务的结果…"
                  rows={1}
                  disabled={loading}
                />
                {loading ? (
                  <button type="button" className={styles.stopBtn} onClick={stopStreaming} title="停止生成">
                    <Square size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.sendBtn}
                    onClick={() => void sendMessage()}
                    disabled={!input.trim()}
                    title="发送（Enter）"
                  >
                    <Send size={15} />
                  </button>
                )}
              </div>
              <div className={styles.hint}>
                Enter 发送 · Shift + Enter 换行 · AI 生成内容需人工复核后再用于任务
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}

/** 思考过程：流式期间默认展开，结束后自动折叠（避免长思考把正文挤出屏幕）。 */
function ThinkingTrace({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  // 流式期间展开、结束后自动折叠：长思考（这次实测 1200 字）会把正文顶到屏幕外。
  // 依赖只看 streaming：用户中途手动展开/收起时，正文增量不会把它弹回去。
  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);
  return (
    <div>
      <button type="button" className={styles.traceToggle} onClick={() => setOpen((o) => !o)}>
        <Brain size={11} />
        思考过程（{text.length} 字）· {open ? '收起' : '展开'}
        {streaming && <span className={styles.caret}>· 进行中</span>}
      </button>
      {open && <div className={styles.traceBody}>{text}</div>}
    </div>
  );
}

/** 工具调用轨迹：名字 + 运行态 + 入参 / 结果（长结果只留尾部）。 */
function ToolTrace({ tools }: { tools: ChatToolCall[] }) {
  return (
    <div>
      {tools.map((t) => (
        <details key={t.id} className={styles.toolItem}>
          <summary>
            <Wrench size={11} />
            <span className={styles.toolName}>{t.name}</span>
            <span className={t.status === 'running' ? styles.toolStateRunning : styles.toolState}>
              {t.status === 'running' ? '（执行中…）' : '（已完成）'}
            </span>
          </summary>
          {t.args && <pre className={styles.toolPre}>{`入参 ${t.args}`}</pre>}
          {t.result && <pre className={styles.toolPre}>{`结果 ${t.result}`}</pre>}
        </details>
      ))}
    </div>
  );
}

export default AiWorkspacePage;
