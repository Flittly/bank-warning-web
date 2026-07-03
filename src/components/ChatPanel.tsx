import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Send, MessageCircle, Save } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  contextText?: string; // 上下文标签文本（如 "📋 任务A  📄 report_xxx.md"）
}

interface ChatSession {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChatPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  selectedSkills?: string[];
  setSelectedSkills?: (skills: string[]) => void;
  chatTasks?: { taskId: string; taskName: string }[];
  setChatTasks?: (tasks: { taskId: string; taskName: string }[]) => void;
  chatReports?: { filename: string; taskId: string }[];
  setChatReports?: (reports: { filename: string; taskId: string }[]) => void;
  onReportsUpdated?: () => void; // 报告文件被 AI 修改后通知父组件刷新
}

function ChatPanel({ collapsed, onToggleCollapse, width, selectedSkills, setSelectedSkills, chatTasks, setChatTasks, chatReports, setChatReports, onReportsUpdated }: ChatPanelProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<{ name: string; label: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions();
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      const res = await fetch('/v0/bank/ai/models');
      const data = await res.json();
      if (data.success && data.models) {
        setModels(data.models);
        if (!selectedModel && data.models.length > 0) setSelectedModel(data.models[0].key);
      }
    } catch (e) { /* ignore */ }
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
    } catch (e) { /* ignore */ }
  };

  const saveChatMessage = async (sessionId: string, role: string, content: string, contextText?: string) => {
    try {
      await fetch(`/v0/bank/ai/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content, contextText: contextText || '' }),
      });
    } catch (e) { /* ignore */ }
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
    } catch (e) {
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

  const sendMessage = async () => {
    if (!input.trim() || !activeSessionId || loading) return;
    const question = input.trim();
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
    saveChatMessage(activeSessionId, 'user', question, contextText);
    // 消息发出后清空上下文标签
    if (setChatReports) setChatReports([]);
    if (setChatTasks) setChatTasks([]);
    setLoading(true);
    try {
      const res = await fetch('/v0/bank/ai/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, sessionId: activeSessionId, skills: selectedSkills || [], taskIds: chatTasks ? chatTasks.map(t => t.taskId) : [], reportIds: chatReports ? chatReports.map(r => r.filename) : [], model: selectedModel }),
      });
      const data = await res.json();
      if (data.success) {
        let content = data.data;
        if (typeof content === 'object' && content !== null) {
          content = content.text || content.thinking || JSON.stringify(content);
        }
        const replyText = String(content);
        setMessages(prev => [...prev, { role: 'assistant', content: replyText }]);
        // 持久化 AI 回复
        saveChatMessage(activeSessionId, 'assistant', replyText);
        // 如果 AI 修改了报告文件，通知父组件刷新
        if (data.updatedReports && data.updatedReports.length > 0 && onReportsUpdated) {
          onReportsUpdated();
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: '请求失败，请重试。' }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: '网络错误，请检查后端服务。' }]);
    } finally {
      setLoading(false);
    }
  };

  const activeSession = sessions.find(s => s.session_id === activeSessionId);

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
                <div style={{
                  fontSize: '0.875rem', lineHeight: 1.6,
                  color: '#1e293b', whiteSpace: 'pre-wrap',
                  background: '#ffffff', padding: '10px 14px',
                  borderRadius: 8, border: '1px solid #e2e8f0',
                }}>
                  {msg.content}
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
            {loading && (
              <div style={{ color: '#94a3b8', fontSize: '0.875rem', fontStyle: 'italic' }}>
                AI 正在思考...
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
                onChange={(e) => setSelectedModel(e.target.value)}
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

export default ChatPanel;
