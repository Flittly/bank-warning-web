import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { Plus, Trash2, Send, MessageCircle, Save, Square, Wrench, Brain } from 'lucide-react';
import { getStoredAiModel, setStoredAiModel, onAiModelChanged } from '../utils/aiModelSettings';
import { streamChat, type ChatStreamEvent } from '../utils/chatStream';

// 版本指纹：加载到这一版模块时在控制台打一行。Vite 对「非编辑器写入」的文件改动
// 不触发 HMR（curl 拿到新内容 ≠ 浏览器内存里是新模块），没有这行指纹就只能靠猜。
// 判据：F12 Console 里没有这行 ⇒ 页面跑的还是旧模块，硬刷新或重启 dev server。
console.info(
  '%c[ChatPanel] 流式版 · POST /ai/agent/chat/stream（有思考块与工具卡片）',
  'color:#0284c7;font-weight:600',
);

/** 一次工具调用在 UI 上的轨迹（入参与结果都是流式增量拼出来的）。 */
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
  contextText?: string; // 上下文标签文本（如 "📋 任务A  📄 report_xxx.md"）
  thinking?: string;    // 思考过程（streamEvents 的 ThinkingBlockDelta 累积）
  tools?: ChatToolCall[];
  streaming?: boolean;  // 该消息是否还在接收增量
}

interface ChatSession {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChatPanelProps {
  collapsed: boolean;
  width: number;
  selectedSkills?: string[];
  setSelectedSkills?: (skills: string[]) => void;
  chatTasks?: { taskId: string; taskName: string }[];
  setChatTasks?: (tasks: { taskId: string; taskName: string }[]) => void;
  chatReports?: { filename: string; taskId: string }[];
  setChatReports?: (reports: { filename: string; taskId: string }[]) => void;
  onReportsUpdated?: () => void; // 报告文件被 AI 修改后通知父组件刷新
}

function ChatPanel({ collapsed, width, selectedSkills, setSelectedSkills, chatTasks, setChatTasks, chatReports, setChatReports, onReportsUpdated }: ChatPanelProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<{ key: string; label: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState(() => getStoredAiModel());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 流式令牌：每次发送自增。收到旧令牌的帧一律丢弃（切会话 / 重发 / 停止）
  const streamTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchSessions();
    fetchModels();
  }, []);

  useEffect(() => onAiModelChanged((key) => {
    if (key) setSelectedModel(key);
  }), []);

  const fetchModels = async () => {
    try {
      const res = await fetch('/v0/bank/ai/models');
      const data = await res.json();
      if (data.success && data.models) {
        setModels(data.models);
        if (data.models.length > 0) {
          const stored = getStoredAiModel();
          const keys = data.models.map((m: { key: string }) => m.key);
          const next = stored && keys.includes(stored) ? stored : data.models[0].key;
          if (next !== selectedModel) setSelectedModel(next);
          if (next !== stored) setStoredAiModel(next);
        }
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/v0/bank/ai/chat/sessions');
      const data = await res.json();
      if (data.success) {
        setSessions(data.sessions);
        if (!activeSessionId && data.sessions.length > 0) {
          const firstId = data.sessions[0].session_id;
          setActiveSessionId(firstId);
          fetchMessages(firstId);
        } else if (data.sessions.length === 0) {
          await createSession();
        }
      }
    } catch (e) {
      console.error('获取会话列表失败', e);
    }
  };

  const fetchMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`/v0/bank/ai/chat/sessions/${sessionId}/messages`);
      const data = await res.json();
      if (data.success && data.messages) {
        setMessages(data.messages);
      }
    } catch { /* ignore */ }
  };

  const saveChatMessage = async (sessionId: string, role: string, content: string, contextText?: string) => {
    try {
      await fetch(`/v0/bank/ai/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content, contextText: contextText || '' }),
      });
    } catch { /* ignore */ }
  };

  const createSession = async () => {
    try {
      const res = await fetch('/v0/bank/ai/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchSessions();
        setActiveSessionId(data.session_id);
        setMessages([]);
      }
    } catch (e) {
      console.error('创建会话失败', e);
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm('确定删除此会话？')) return;
    try {
      await fetch(`/v0/bank/ai/chat/sessions/${id}`, { method: 'DELETE' });
      await fetchSessions();
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error('删除会话失败', e);
    }
  };

  const saveReport = async (content: string) => {
    try {
      const match = content.match(/task-(\d+)/);
      const taskId = match ? match[0] : '';
      const res = await fetch('/v0/bank/ai/reports/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, taskId }),
      });
      const data = await res.json();
      if (data.success) {
        window.dispatchEvent(new CustomEvent('report-saved', { detail: { taskId } }));
        alert('报告已保存: ' + data.filename);
      } else {
        alert('保存失败: ' + (data.error || '未知错误'));
      }
    } catch {
      alert('保存失败');
    }
  };

  const addSkill = (name: string) => {
    if (!setSelectedSkills || !selectedSkills) return;
    if (!selectedSkills.includes(name)) {
      setSelectedSkills([...selectedSkills, name]);
    }
  };

  const removeSkill = (name: string) => {
    if (!setSelectedSkills || !selectedSkills) return;
    setSelectedSkills(selectedSkills.filter(s => s !== name));
  };

  /**
   * 只改「最后一条 assistant 消息」。
   *
   * <p>流式下每个 delta 都会调用一次，所以这里按索引原位替换、不动其它消息，
   * 也不重建数组结构（否则整段列表会重新挂载、丢失折叠态）。
   */
  const patchLast = (token: number, fn: (m: ChatMessage) => ChatMessage) => {
    if (streamTokenRef.current !== token) return;
    setMessages(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'assistant') return prev;
      const next = prev.slice();
      next[next.length - 1] = fn({ ...last });
      return next;
    });
  };

  const stopStreaming = () => {
    streamTokenRef.current += 1; // 让在途帧失效
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setMessages(prev => {
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
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeSessionId || loading) return;
    const question = input.trim();
    const sessionIdAtSend = activeSessionId;
    // 捕获当前上下文标签，拼成显示文本
    const ctxParts: string[] = [];
    if (chatReports && chatReports.length > 0) {
      ctxParts.push(...chatReports.map(r => `📄 ${r.filename}`));
    }
    if (chatTasks && chatTasks.length > 0) {
      ctxParts.push(...chatTasks.map(t => `📋 ${t.taskName || t.taskId}`));
    }
    const contextText = ctxParts.length > 0 ? ctxParts.join('  ') : undefined;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: question, contextText }]);
    // 持久化用户消息
    saveChatMessage(sessionIdAtSend, 'user', question, contextText);
    // 消息发出后清空上下文标签
    if (setChatReports) setChatReports([]);
    if (setChatTasks) setChatTasks([]);

    const token = streamTokenRef.current + 1;
    streamTokenRef.current = token;
    const abort = new AbortController();
    abortRef.current = abort;
    setLoading(true);
    // 先占一条空的 assistant 消息：思考 / 工具 / 正文都往上长，UI 只追加不重建
    setMessages(prev => [...prev, { role: 'assistant', content: '', thinking: '', tools: [], streaming: true }]);

    let finalText = '';
    let updatedReports: { filename: string; updated?: string; error?: string }[] = [];
    try {
      await streamChat(
        {
          question,
          sessionId: sessionIdAtSend,
          skills: selectedSkills || [],
          taskIds: chatTasks ? chatTasks.map(t => t.taskId) : [],
          reportIds: chatReports ? chatReports.map(r => r.filename) : [],
          model: selectedModel,
        },
        (event: ChatStreamEvent) => {
          switch (event.type) {
            case 'thinking':
              patchLast(token, m => ({ ...m, thinking: `${m.thinking || ''}${event.delta}` }));
              break;
            case 'text':
              patchLast(token, m => ({ ...m, content: `${m.content}${event.delta}` }));
              break;
            case 'tool_call':
              patchLast(token, m => ({
                ...m,
                tools: [...(m.tools || []),
                  { id: event.id, name: event.name, args: '', result: '', status: 'running' }],
              }));
              break;
            case 'tool_args':
              patchLast(token, m => ({
                ...m,
                tools: (m.tools || []).map(t => (t.id === event.id ? { ...t, args: t.args + event.delta } : t)),
              }));
              break;
            case 'tool_call_end':
              patchLast(token, m => ({
                ...m,
                tools: (m.tools || []).map(t => (t.id === event.id ? { ...t, args: event.args || t.args } : t)),
              }));
              break;
            case 'tool_result':
              // 只留尾部 1200 字：工具结果可能上万字，全量塞进状态会拖垮渲染
              patchLast(token, m => ({
                ...m,
                tools: (m.tools || []).map(t =>
                  t.id === event.id ? { ...t, result: `${t.result}${event.delta}`.slice(-1200) } : t),
              }));
              break;
            case 'tool_result_end':
              patchLast(token, m => ({
                ...m,
                tools: (m.tools || []).map(t => (t.id === event.id ? { ...t, status: 'done' } : t)),
              }));
              break;
            case 'warn':
              patchLast(token, m => ({
                ...m,
                content: `${m.content}${m.content ? '\n\n' : ''}⚠ ${event.message}`,
              }));
              break;
            case 'error':
              patchLast(token, m => ({ ...m, streaming: false, content: m.content || `⚠ ${event.message}` }));
              break;
            case 'done':
              // done.data 才是收口后的正文：已剥离 <!--REPORT--> 之后的报告全文
              finalText = event.data;
              updatedReports = event.updatedReports || [];
              patchLast(token, m => ({
                ...m,
                streaming: false,
                content: event.data || m.content,
                thinking: event.thinking || m.thinking,
              }));
              break;
            default:
              break; // start / round：不上屏
          }
        },
        abort.signal,
      );
      if (finalText && streamTokenRef.current === token) {
        saveChatMessage(sessionIdAtSend, 'assistant', finalText);
      }
      if (updatedReports.length > 0 && onReportsUpdated) {
        onReportsUpdated();
      }
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      patchLast(token, m => ({
        ...m,
        streaming: false,
        content: m.content || (aborted ? '（已停止）' : '网络错误，请检查后端服务。'),
      }));
    } finally {
      if (streamTokenRef.current === token) setLoading(false);
      abortRef.current = null;
    }
  };

  return (
    <div style={{
      display: collapsed ? 'none' : 'flex',
      flexDirection: 'column',
      height: '100%',
      width: width,
      minWidth: width,
      overflow: 'hidden',
      background: 'rgba(255, 255, 255, 0.6)',
      backdropFilter: 'blur(16px) saturate(1.3)',
      WebkitBackdropFilter: 'blur(16px) saturate(1.3)',
      borderLeft: '1px solid rgba(255, 255, 255, 0.3)',
    }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={(e) => {
        e.preventDefault();
        const name = e.dataTransfer.getData('text/plain');
        if (name) addSkill(name);
        const taskId = e.dataTransfer.getData('application/task-id');
        if (taskId && setChatTasks) {
          const taskName = e.dataTransfer.getData('application/task-name') || taskId;
          setChatTasks([...(chatTasks || []), { taskId, taskName }]);
        }
        const reportFilename = e.dataTransfer.getData('application/report-filename');
        if (reportFilename && setChatReports) {
          const reportTaskId = e.dataTransfer.getData('application/report-taskid') || '';
          setChatReports([...(chatReports || []), { filename: reportFilename, taskId: reportTaskId }]);
        }
      }}
    >
      {!collapsed && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <MessageCircle size={14} color="#94A3B8" />
              <select
                value={activeSessionId || ''}
                onChange={(e) => {
                  setActiveSessionId(e.target.value);
                  fetchMessages(e.target.value);
                }}
                style={{
                  flex: 1, border: '1px solid rgba(0,0,0,0.08)',
                  background: 'rgba(0,0,0,0.02)',
                  fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer',
                  borderRadius: 10, padding: '6px 8px',
                  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis',
                  outline: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
                  appearance: 'none', color: '#334155',
                }}
              >
                {sessions.map(s => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={createSession}
                style={{
                  width: 30, height: 30, minWidth: 30, minHeight: 30,
                  flexShrink: 0, padding: 0, boxSizing: 'border-box',
                  border: 'none',
                  background:
                    'radial-gradient(ellipse at 20% 0%, rgba(255,255,255,0.3) 0%, transparent 40%), ' +
                    'radial-gradient(ellipse at 80% 100%, rgba(16,185,129,0.2) 0%, transparent 50%), ' +
                    'rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(10px) saturate(1.4)',
                  WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
                  cursor: 'pointer',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.5)',
                  transition: 'all 0.2s',
                }}
                title="新建会话"
              >
                <Plus size={14} color="#065F46" />
              </button>
              <button
                onClick={() => activeSessionId && deleteSession(activeSessionId)}
                disabled={!activeSessionId}
                style={{
                  width: 30, height: 30, minWidth: 30, minHeight: 30,
                  flexShrink: 0, padding: 0, boxSizing: 'border-box',
                  border: 'none',
                  background:
                    'radial-gradient(ellipse at 20% 0%, rgba(255,255,255,0.3) 0%, transparent 40%), ' +
                    'radial-gradient(ellipse at 80% 100%, rgba(239,68,68,0.18) 0%, transparent 50%), ' +
                    'rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(10px) saturate(1.4)',
                  WebkitBackdropFilter: 'blur(10px) saturate(1.4)',
                  cursor: activeSessionId ? 'pointer' : 'default',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: activeSessionId ? 1 : 0.3,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.5)',
                  transition: 'all 0.2s',
                }}
                title="删除会话"
              >
                <Trash2 size={16} color="#64748B" />
              </button>
            </div>
          </div>

          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px',
            background: '#f8fafc',
          }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: '0.75rem', fontWeight: 600,
                  color: msg.role === 'user' ? '#2563eb' : '#059669',
                  marginBottom: 4,
                }}>
                  {msg.role === 'user' ? '我' : 'AI 助手'}
                </div>
                {msg.contextText && (
                  <div style={{
                    fontSize: '0.68rem', color: '#64748b',
                    marginBottom: 4, padding: '2px 6px',
                    background: '#f1f5f9', borderRadius: 6,
                    display: 'inline-block',
                  }}>
                    {msg.contextText}
                  </div>
                )}
                {msg.role === 'assistant' && msg.thinking && (
                  <ThinkingTrace text={msg.thinking} streaming={!!msg.streaming} />
                )}
                {msg.role === 'assistant' && msg.tools && msg.tools.length > 0 && (
                  <ToolTrace tools={msg.tools} />
                )}
                <div style={{
                  fontSize: '0.875rem', lineHeight: 1.6,
                  color: '#1e293b', whiteSpace: 'pre-wrap',
                  background: '#ffffff', padding: '10px 14px',
                  borderRadius: 8, border: '1px solid #e2e8f0',
                }}>
                  {msg.content}
                  {msg.streaming && !msg.content && (
                    <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>正在生成…</span>
                  )}
                  {msg.streaming && msg.content && (
                    // 流式光标：随增量一起动，比 spinner 更能说明"还在往里写"
                    <span style={{ color: '#0ea5e9', marginLeft: 2 }}>▍</span>
                  )}
                </div>
                {msg.role === 'assistant' && msg.content.length > 20 && (
                  <button
                    onClick={() => saveReport(msg.content)}
                    style={{
                      marginTop: 4, padding: '2px 8px', fontSize: '0.7rem',
                      background: '#f1f5f9', border: '1px solid #e2e8f0',
                      borderRadius: 4, cursor: 'pointer', color: '#64748b',
                      display: 'flex', alignItems: 'center', gap: 3,
                    }}
                  >
                    <Save size={12} /> 保存为报告
                  </button>
                )}
              </div>
            ))}
            {loading && !messages.some(m => m.streaming) && (
              <div style={{ color: '#94a3b8', fontSize: '0.875rem', fontStyle: 'italic' }}>
                正在连接模型…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {((selectedSkills && selectedSkills.length > 0) || (chatTasks && chatTasks.length > 0) || (chatReports && chatReports.length > 0)) && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 4,
              padding: '6px 12px', background: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
            }}>
              {chatReports && chatReports.map((r, i) => (
                <span key={r.filename} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', fontSize: '0.72rem',
                  background: '#fef3c7', color: '#d97706',
                  borderRadius: 10, cursor: 'default',
                }}>
                  📄 {r.filename}
                  <button onClick={() => { if (setChatReports) setChatReports(chatReports.filter((_, j) => j !== i)); }} style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    padding: 0, display: 'flex', color: '#d97706', fontSize: '0.8rem',
                  }}>×</button>
                </span>
              ))}
              {chatTasks && chatTasks.map((t, i) => (
                <span key={t.taskId} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', fontSize: '0.72rem',
                  background: '#dcfce7', color: '#16a34a',
                  borderRadius: 10, cursor: 'default',
                }}>
                  📋 {t.taskName || t.taskId}
                  <button onClick={() => { if (setChatTasks) setChatTasks(chatTasks.filter((_, j) => j !== i)); }} style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    padding: 0, display: 'flex', color: '#16a34a', fontSize: '0.8rem',
                  }}>×</button>
                </span>
              ))}
              {selectedSkills && selectedSkills.map(name => (
                <span key={name} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', fontSize: '0.72rem',
                  background: '#dbeafe', color: '#2563eb',
                  borderRadius: 10, cursor: 'default',
                }}>
                  {name}
                  <button onClick={() => removeSkill(name)} style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    padding: 0, display: 'flex', color: '#2563eb', fontSize: '0.8rem',
                  }}>×</button>
                </span>
              ))}
            </div>
          )}

          <div style={{
            display: 'flex', gap: 8, padding: '4px 16px 12px 16px',
            background: '#ffffff',
          }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="输入问题，Enter 发送..."
              disabled={loading}
              style={{
                flex: 1, border: '1px solid #e2e8f0', borderRadius: 8,
                padding: '8px 12px', fontSize: '0.875rem', resize: 'none',
                minHeight: 40, maxHeight: 120, fontFamily: 'inherit',
                outline: 'none',
              }}
              rows={1}
            />
            {loading && (
              <button
                onClick={stopStreaming}
                title="停止生成（会中断后端的 agent 推理）"
                style={{
                  border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
                  borderRadius: 14, padding: '8px 12px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem',
                }}
              >
                <Square size={13} /> 停止
              </button>
            )}
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{
                border: loading ? 'none' : '1.5px solid rgba(148,163,184,0.5)',
                background: loading ? '#94a3b8'
                  : 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(203,213,225,0.2) 30%, rgba(148,163,184,0.15) 70%, rgba(255,255,255,0.1) 100%)',
                backdropFilter: loading ? 'none' : 'blur(8px) saturate(1.2)',
                WebkitBackdropFilter: loading ? 'none' : 'blur(8px) saturate(1.2)',
                color: loading ? '#ffffff' : '#475569',
                borderRadius: 14, padding: '8px 12px',
                boxShadow: loading ? 'none' : '0 2px 6px rgba(0,0,0,0.08), 0 0 0 1px rgba(255,255,255,0.3), inset 0 1px 0 rgba(255,255,255,0.5)',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center',
              }}
            >
              <Send size={16} />
            </button>
          </div>

          {models.length > 0 && (
            <div style={{ padding: '2px 16px 6px 16px', background: '#ffffff' }}>
              <select
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  setStoredAiModel(e.target.value);
                }}
                style={{
                  border: 'none', background: 'transparent',
                  fontSize: '0.68rem', color: '#94a3b8', outline: 'none',
                  cursor: 'pointer', padding: 0,
                }}
              >
                {models.map(m => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 思考过程块：流式期间默认展开、结束后自动折叠。
 *
 * <p>用组件自身的 state 而不是父级控制：父级每个 delta 都重渲染，
 * 受控折叠态会被"自动展开"反复覆盖，用户手动收起后又会弹开。
 */
function ThinkingTrace({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          border: '1px solid #e2e8f0', background: '#f8fafc', color: '#64748b',
          borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', cursor: 'pointer',
        }}
      >
        <Brain size={11} />
        思考过程（{text.length} 字）· {open ? '收起' : '展开'}
        {streaming && <span style={{ color: '#0ea5e9' }}>· 进行中</span>}
      </button>
      {open && (
        <div style={{
          marginTop: 4, fontSize: '0.72rem', lineHeight: 1.55, color: '#64748b',
          whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto',
          background: '#f8fafc', border: '1px dashed #cbd5e1',
          borderRadius: 6, padding: '6px 8px',
        }}>
          {text}
        </div>
      )}
    </div>
  );
}

/** 工具调用轨迹：名字 + 运行态 + 入参 / 结果（都可折叠，长结果只留尾部）。 */
function ToolTrace({ tools }: { tools: ChatToolCall[] }) {
  const preStyle: CSSProperties = {
    margin: '4px 0 0', fontSize: '0.68rem', lineHeight: 1.5, color: '#475569',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    maxHeight: 120, overflowY: 'auto',
    background: '#ffffff', border: '1px solid #e0f2fe', borderRadius: 4, padding: '4px 6px',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
      {tools.map(t => (
        <details key={t.id} style={{
          background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, padding: '3px 8px',
        }}>
          <summary style={{
            cursor: 'pointer', fontSize: '0.72rem', color: '#0369a1',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Wrench size={11} />
            <span style={{ fontWeight: 600 }}>{t.name}</span>
            <span style={{ color: t.status === 'running' ? '#d97706' : '#059669' }}>
              {t.status === 'running' ? '（执行中…）' : '（已完成）'}
            </span>
          </summary>
          {t.args && <pre style={preStyle}>{`入参 ${t.args}`}</pre>}
          {t.result && <pre style={preStyle}>{`结果 ${t.result}`}</pre>}
        </details>
      ))}
    </div>
  );
}

export default ChatPanel;
