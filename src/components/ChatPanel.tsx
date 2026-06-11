import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Send, MessageCircle } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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
}

function ChatPanel({ collapsed, onToggleCollapse, width }: ChatPanelProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

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
          setActiveSessionId(data.sessions[0].session_id);
        } else if (data.sessions.length === 0) {
          await createSession();
        }
      }
    } catch (e) {
      console.error('获取会话列表失败', e);
    }
  };

  const createSession = async () => {
    try {
      const res = await fetch('/v0/bank/ai/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新会话' }),
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

  const sendMessage = async () => {
    if (!input.trim() || !activeSessionId || loading) return;
    const question = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setLoading(true);
    try {
      const res = await fetch('/v0/bank/ai/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, sessionId: activeSessionId }),
      });
      const data = await res.json();
      if (data.success) {
        let content = data.data;
        if (typeof content === 'object' && content !== null) {
          content = content.text || content.thinking || JSON.stringify(content);
        }
        setMessages(prev => [...prev, { role: 'assistant', content: String(content) }]);
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
    }}>
      {!collapsed && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderBottom: '1px solid #e2e8f0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <MessageCircle size={16} />
              <select
                value={activeSessionId || ''}
                onChange={(e) => {
                  setActiveSessionId(e.target.value);
                  setMessages([]);
                }}
                style={{
                  flex: 1, border: 'none', background: 'transparent',
                  fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer',
                  maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
                  outline: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
                  appearance: 'none',
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
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: 4, borderRadius: 4, color: '#64748b',
                }}
                title="新建会话"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={() => activeSessionId && deleteSession(activeSessionId)}
                disabled={!activeSessionId}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: 4, borderRadius: 4, color: '#64748b',
                  opacity: activeSessionId ? 1 : 0.3,
                }}
                title="删除会话"
              >
                <Trash2 size={16} />
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
                <div style={{
                  fontSize: '0.875rem', lineHeight: 1.6,
                  color: '#1e293b', whiteSpace: 'pre-wrap',
                  background: '#ffffff', padding: '10px 14px',
                  borderRadius: 8, border: '1px solid #e2e8f0',
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ color: '#94a3b8', fontSize: '0.875rem', fontStyle: 'italic' }}>
                AI 正在思考...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div style={{
            display: 'flex', gap: 8, padding: '12px 16px',
            borderTop: '1px solid #e2e8f0', background: '#ffffff',
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
                border: 'none', background: loading ? '#94a3b8' : '#2563eb',
                color: '#ffffff', borderRadius: 8, padding: '8px 12px',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center',
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default ChatPanel;
