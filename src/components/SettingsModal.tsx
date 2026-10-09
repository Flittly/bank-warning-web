import { useEffect, useState } from 'react';
import { message } from 'antd';
import styles from './Modal.module.css';
import { getStoredAiModel, setStoredAiModel } from '../utils/aiModelSettings';

interface AiModel {
  key: string;
  label: string;
  modelName: string;
  baseUrl: string;
  apiKeyMasked: string;
}

interface SettingsModalProps {
  username?: string;
  roleLabel?: string;
  onClose: () => void;
  onReplayTour?: () => void;
}

const EMPTY_ADD_FORM = { key: '', label: '', modelName: '', baseUrl: '', apiKey: '' };

export default function SettingsModal({ username, roleLabel, onClose, onReplayTour }: SettingsModalProps) {
  const [models, setModels] = useState<AiModel[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [adding, setAdding] = useState(false);

  const fetchModels = async (preferKey?: string) => {
    try {
      const res = await fetch('/v0/bank/ai/models');
      const data = await res.json();
      if (data.success && Array.isArray(data.models)) {
        const list: AiModel[] = data.models;
        setModels(list);
        if (list.length > 0) {
          const stored = preferKey || getStoredAiModel();
          const found = list.find((m) => m.key === stored) || list[0];
          setSelectedKey(found.key);
          setBaseUrl(found.baseUrl || '');
          setModelName(found.modelName || '');
          setApiKey('');
          if (found.key !== getStoredAiModel()) setStoredAiModel(found.key);
        } else {
          setSelectedKey('');
        }
      }
    } catch {
      message.error('获取模型列表失败');
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const selected = models.find((m) => m.key === selectedKey);

  const handleSelectModel = (key: string) => {
    const m = models.find((item) => item.key === key);
    setSelectedKey(key);
    setApiKey('');
    setBaseUrl(m?.baseUrl || '');
    setModelName(m?.modelName || '');
    setStoredAiModel(key);
  };

  const handleSave = async () => {
    if (!selectedKey) return;
    const payload: Record<string, string> = {};
    if (apiKey.trim()) payload.apiKey = apiKey.trim();
    if (baseUrl.trim()) payload.baseUrl = baseUrl.trim();
    if (modelName.trim()) payload.modelName = modelName.trim();
    if (Object.keys(payload).length === 0) {
      message.info('未修改任何内容');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/v0/bank/ai/models/${encodeURIComponent(selectedKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        message.success('模型配置已保存');
        setApiKey('');
        await fetchModels(selectedKey);
      } else {
        message.error(data.error || '保存失败');
      }
    } catch {
      message.error('网络异常，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    const { key, label, modelName: mn, baseUrl: bu, apiKey: ak } = addForm;
    if (!key.trim() || !label.trim() || !mn.trim() || !bu.trim() || !ak.trim()) {
      message.warning('请填写所有字段');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/v0/bank/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key.trim(),
          label: label.trim(),
          modelName: mn.trim(),
          baseUrl: bu.trim(),
          apiKey: ak.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        message.success('模型已添加');
        setAddForm(EMPTY_ADD_FORM);
        setShowAddForm(false);
        await fetchModels();
      } else {
        message.error(data.error || '添加失败');
      }
    } catch {
      message.error('网络异常，请稍后重试');
    } finally {
      setAdding(false);
    }
  };

  const handleResetPrefs = () => {
    localStorage.removeItem('tour-seen');
    localStorage.removeItem('ai-chat-model');
    if (models.length > 0) setStoredAiModel(models[0].key);
    message.success('已重置本机偏好设置');
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.container} ${styles.containerMedium}`} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>设置</h3>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>账户信息</legend>
          <div className={styles.infoRow}>
            <span>用户名</span>
            <strong>{username || '-'}</strong>
          </div>
          <div className={styles.infoRow}>
            <span>角色</span>
            <strong>{roleLabel || '-'}</strong>
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>AI 模型</legend>
          <div className={styles.mb15}>
            <label className={styles.label}>会话模型</label>
            <select className={styles.select} value={selectedKey} onChange={(e) => handleSelectModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className={`${styles.grid2} ${styles.mb15}`}>
            <div>
              <label className={styles.label}>API Key</label>
              <div className={styles.inputRow}>
                <input
                  type={showKey ? 'text' : 'password'}
                  className={styles.input}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={selected?.apiKeyMasked ? `当前 ${selected.apiKeyMasked}` : '未配置'}
                />
                <button type="button" className={styles.smallButton} onClick={() => setShowKey((v) => !v)}>
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
            </div>
            <div>
              <label className={styles.label}>模型型号</label>
              <input
                type="text"
                className={styles.input}
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder={selected?.modelName || ''}
              />
            </div>
          </div>
          <div className={styles.mb15}>
            <label className={styles.label}>Base URL</label>
            <input
              type="text"
              className={styles.input}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={selected?.baseUrl || ''}
            />
            <div className={styles.hint}>留空则不修改；保存后下次对话生效</div>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={handleSave} disabled={saving || !selectedKey}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>新增模型</legend>
          {!showAddForm ? (
            <button type="button" className={styles.cancelButton} onClick={() => setShowAddForm(true)}>
              添加新模型
            </button>
          ) : (
            <>
              <div className={`${styles.grid2} ${styles.mb15}`}>
                <div>
                  <label className={styles.label}>模型 Key</label>
                  <input
                    type="text"
                    className={styles.input}
                    value={addForm.key}
                    onChange={(e) => setAddForm((f) => ({ ...f, key: e.target.value }))}
                    placeholder="唯一标识，如 deepseek"
                  />
                </div>
                <div>
                  <label className={styles.label}>显示名称</label>
                  <input
                    type="text"
                    className={styles.input}
                    value={addForm.label}
                    onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="如 DeepSeek V3"
                  />
                </div>
              </div>
              <div className={styles.mb15}>
                <label className={styles.label}>模型型号</label>
                <input
                  type="text"
                  className={styles.input}
                  value={addForm.modelName}
                  onChange={(e) => setAddForm((f) => ({ ...f, modelName: e.target.value }))}
                  placeholder="如 deepseek-chat"
                />
              </div>
              <div className={styles.mb15}>
                <label className={styles.label}>Base URL</label>
                <input
                  type="text"
                  className={styles.input}
                  value={addForm.baseUrl}
                  onChange={(e) => setAddForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder="如 https://api.deepseek.com/v1"
                />
              </div>
              <div className={styles.mb15}>
                <label className={styles.label}>API Key</label>
                <input
                  type="password"
                  className={styles.input}
                  value={addForm.apiKey}
                  onChange={(e) => setAddForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="请输入 API Key"
                />
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={() => {
                    setShowAddForm(false);
                    setAddForm(EMPTY_ADD_FORM);
                  }}
                >
                  取消
                </button>
                <button type="button" className={styles.primaryButton} onClick={handleAdd} disabled={adding}>
                  {adding ? '添加中...' : '添加'}
                </button>
              </div>
            </>
          )}
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>通用</legend>
          <div className={styles.infoRow}>
            <span>新手引导</span>
            <button type="button" className={styles.smallButton} onClick={onReplayTour}>
              重新播放
            </button>
          </div>
          <div className={styles.infoRow}>
            <span>重置本机偏好（引导、模型选择）</span>
            <button type="button" className={styles.smallButton} onClick={handleResetPrefs}>
              重置
            </button>
          </div>
        </fieldset>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
