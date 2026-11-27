import { useEffect, useState } from 'react';
import { Input, Modal } from 'antd';

/**
 * 添加一个「自定义模型」。
 *
 * <p>为什么要有它：对话框底部的模型下拉只列 `ai_models` 表里已有的行，新增模型只能
 * 跑到「设置 → AI 模型 → 添加新模型」里填一遍再回来。下拉里补一个入口，加了就能直接选。
 *
 * <p>字段与后端 `POST /v0/bank/ai/models` 一一对应，**五个字段全部必填**：
 * `key`（唯一标识，也是后续 PUT/DELETE 的路径参数）、`label`（下拉里显示的名字）、
 * `modelName`（真正发给服务商的模型名，如 `deepseek-flash`）、`baseUrl`（OpenAI 兼容端点，
 * 要写到 `/v1/` 这一级）、`apiKey`。
 *
 * <p>`key` 在库里是 UNIQUE（`ai_models_model_key_key`），重复插入会抛 DuplicateKey，
 * 经全局异常处理变成一句笼统的 500。所以这里先用父级传下来的 `existingKeys` 挡住，
 * 不让用户提交一个注定失败的请求。
 */
export interface AddAiModelModalProps {
  open: boolean;
  /** 已有模型的 key；用于在提交前拦下重名（库里有 UNIQUE 约束，重复提交只会拿到 500）。 */
  existingKeys: string[];
  onCancel: () => void;
  /** 添加成功回调，参数是新建的 key —— 父级据此刷新列表并自动选中它。 */
  onAdded: (key: string) => void;
}

const EMPTY_FORM = { key: '', label: '', modelName: '', baseUrl: '', apiKey: '' };

/** key 会被当作 PUT/DELETE 的路径段，也会被写进 localStorage，只放安全字符。 */
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,60}$/;

export default function AddAiModelModal({
  open,
  existingKeys,
  onCancel,
  onAdded,
}: AddAiModelModalProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 每次打开都清空：把上一次填的 apiKey 留在框里，下次很容易被当成"已经填好了"直接提交。
  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setError(null);
    setSaving(false);
  }, [open]);

  const patch = (field: keyof typeof EMPTY_FORM) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const validate = (): string | null => {
    const key = form.key.trim();
    const label = form.label.trim();
    const modelName = form.modelName.trim();
    const baseUrl = form.baseUrl.trim();
    const apiKey = form.apiKey.trim();

    if (!key || !label || !modelName || !baseUrl || !apiKey) return '五项都要填：标识、显示名称、模型名、Base URL、API Key';
    if (!KEY_PATTERN.test(key)) return '标识只能用字母、数字、点、下划线、短横线（最长 60）';
    if (existingKeys.includes(key)) return `标识「${key}」已存在，换一个`;
    if (!/^https?:\/\//i.test(baseUrl)) return 'Base URL 要以 http:// 或 https:// 开头';
    return null;
  };

  const submit = async () => {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setSaving(true);
    const key = form.key.trim();
    try {
      const res = await fetch('/v0/bank/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          label: form.label.trim(),
          modelName: form.modelName.trim(),
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
        }),
      });
      // 后端失败时是 200 + success:false（参数缺失），也可能直接 5xx（库里重名）。
      // 两条路都要读到 error 文本，否则用户只看到"添加失败"。
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || `添加失败（HTTP ${res.status}）`);
        return;
      }
      onAdded(key);
    } catch {
      setError('网络异常，模型没有添加成功');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="添加自定义模型"
      width={520}
      okText={saving ? '添加中…' : '添加'}
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => void submit()}
      onCancel={() => {
        if (!saving) onCancel();
      }}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        <Field
          label="模型标识"
          hint="唯一标识，形如 deepseek-v4。会被写进请求体与本地偏好，建议只用英文。"
        >
          <Input value={form.key} onChange={patch('key')} placeholder="如 deepseek-v4" maxLength={60} />
        </Field>

        <Field label="显示名称" hint="下拉列表里显示的文字。">
          <Input value={form.label} onChange={patch('label')} placeholder="如 DeepSeek V4" maxLength={200} />
        </Field>

        <Field label="模型名（model）" hint="真正发给服务商的模型名，必须与服务商文档一致。">
          <Input value={form.modelName} onChange={patch('modelName')} placeholder="如 deepseek-flash" maxLength={200} />
        </Field>

        <Field label="Base URL" hint="OpenAI 兼容端点，要写到 /v1/ 这一级。">
          <Input
            value={form.baseUrl}
            onChange={patch('baseUrl')}
            placeholder="如 https://api.deepseek.com/v1/"
            maxLength={500}
          />
        </Field>

        <Field label="API Key" hint="只存在服务端 ai_models 表里；界面上只会显示前后各 4 位。">
          <Input.Password
            value={form.apiKey}
            onChange={patch('apiKey')}
            placeholder="sk-..."
            maxLength={500}
            autoComplete="off"
          />
        </Field>

        {error && (
          <div
            role="alert"
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(220,38,38,0.06)',
              color: '#b91c1c',
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: '#334155' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.45 }}>{hint}</span>}
    </label>
  );
}
