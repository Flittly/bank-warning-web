import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Spin, Table, Tag, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getAccessToken } from '../auth/tokenManager';
import './AdminUserPage.css';
import './SkillSecurityPage.css';

const API_BASE = '/v0/admin/skill-security';

type Warning = { level: string; text: string };
type Knob = { key: string; label: string; value: unknown };
type Stage = { title: string; items: Knob[] };
type Preset = {
  name: string;
  label: string;
  description: string;
  sandboxMode: string;
  sandboxTimeoutSeconds: number;
  sandboxMaxOutputBytes: number;
  forbiddenImportCount: number;
  failOnViolation: boolean;
  requireChecksumManifest: boolean;
  requireSignedManifest: boolean;
  enforceOutputContract: boolean;
  failOnUnapprovedPermission: boolean;
};
type ProfileResp = {
  success: boolean;
  error?: string;
  profile: string;
  profileLabel: string;
  profileDescription: string;
  presetMatches: boolean;
  killSwitch: boolean;
  signingKeyConfigured: boolean;
  updatedBy?: string;
  updatedAt?: string;
  warnings: Warning[];
  stages: Stage[];
  presets: Preset[];
};
type HistoryRecord = {
  skillName: string;
  version: string;
  eventType: string;
  detail: string;
  blocked: boolean;
  createdAt: string;
};

/** 档位松紧排序，用于判断这次操作是"收紧"还是"放宽" */
const RANK: Record<string, number> = { LOOSE: 0, STANDARD: 1, STRICT: 2 };

const humanBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const eventTag = (eventType: string, blocked: boolean) => {
  if (eventType === 'KILL_SWITCH') {
    return blocked ? <Tag color="red">熔断开启</Tag> : <Tag color="green">熔断解除</Tag>;
  }
  if (eventType === 'PROFILE_CHANGED') return <Tag color="blue">档位切换</Tag>;
  if (eventType === 'PROFILE_TUNED') return <Tag color="orange">逐项微调</Tag>;
  if (eventType === 'PROFILE_INITIALIZED') return <Tag>首次落库</Tag>;
  return <Tag>{eventType}</Tag>;
};

export default function SkillSecurityPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = getAccessToken();

  const [data, setData] = useState<ProfileResp | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [p, h] = await Promise.all([
        fetch(`${API_BASE}/profile`).then((r) => r.json()),
        fetch(`${API_BASE}/history?limit=50`).then((r) => r.json()),
      ]);
      if (p && p.success === false) {
        message.error(p.error || '加载安全档位失败');
      } else {
        setData(p);
      }
      setHistory(h?.history || []);
    } catch {
      message.error('加载安全档位失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const post = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const resp: ProfileResp = await res.json();
      if (resp.success) {
        message.success('已生效（无需重启）');
        setData(resp);
        fetchAll();
        return true;
      }
      message.error(resp.error || '操作失败');
    } catch {
      message.error('网络错误');
    } finally {
      setBusy(false);
    }
    return false;
  };

  const applyProfile = (next: Preset) => {
    if (!data || data.profile === next.name) return;
    const tightening = (RANK[next.name] ?? 1) > (RANK[data.profile] ?? 1);
    Modal.confirm({
      title: `切换到「${next.label}」档位？`,
      width: 520,
      content: (
        <div className="ssp-confirm">
          <p>{next.description}</p>
          <ul>
            <li>沙箱：{next.sandboxMode}，超时 {next.sandboxTimeoutSeconds}s，输出上限 {humanBytes(next.sandboxMaxOutputBytes)}</li>
            <li>危险模块黑名单：{next.forbiddenImportCount} 项，{next.failOnViolation ? '发现即拒绝' : '仅告警不拦截'}</li>
            <li>校验清单：{next.requireChecksumManifest ? '必须有' : '不要求'}
              {next.requireSignedManifest ? '（且必须签名）' : ''}</li>
            <li>权限未审批：{next.failOnUnapprovedPermission ? '拒绝执行' : '仅告警'}</li>
            <li>输出契约：{next.enforceOutputContract ? '强制校验' : '不强制'}</li>
          </ul>
          <p className="ssp-confirm-note">
            三层防护（校验 / 沙箱 / 治理）会同时切换到该档位，<strong>立即生效、无需重启</strong>。
            熔断状态、版本白名单、隔离清单属于运维状态，会被<strong>原样保留</strong>。
            本次操作会写入审计日志。
          </p>
        </div>
      ),
      okText: '切换档位',
      cancelText: '取消',
      okButtonProps: { danger: !tightening },
      onOk: () => post(`${API_BASE}/profile`, { profile: next.name }),
    });
  };

  const toggleKillSwitch = () => {
    if (!data) return;
    const turningOn = !data.killSwitch;
    Modal.confirm({
      title: turningOn ? '开启全局熔断？' : '解除全局熔断？',
      width: 520,
      content: (
        <div className="ssp-confirm">
          <p>
            {turningOn
              ? '开启后，所有 skill 执行都会被治理裁决直接拒绝——这是出事时的"第一下按钮"。'
              : '解除后，skill 执行恢复按当前档位放行。请确认风险已排除。'}
          </p>
          <p className="ssp-confirm-note">
            熔断是<strong>独立于档位</strong>的应急开关：切换档位不会解除它，反之亦然。立即生效、无需重启，并写入审计日志。
          </p>
        </div>
      ),
      okText: turningOn ? '开启熔断' : '解除熔断',
      cancelText: '取消',
      okButtonProps: { danger: turningOn },
      onOk: () => post(`${API_BASE}/kill-switch`, { enabled: turningOn }),
    });
  };

  const valueClass = (key: string, value: unknown) => {
    if (typeof value !== 'boolean') return 'ssp-value-text';
    if (key === 'killSwitch') return value ? 'ssp-value-danger' : 'ssp-value-ok';
    return value ? 'ssp-value-ok' : 'ssp-value-warn';
  };

  const renderValue = (knob: Knob) => {
    if (typeof knob.value === 'boolean') return knob.value ? '是' : '否';
    if (knob.value === null || knob.value === undefined || knob.value === '') return '未设置';
    return String(knob.value);
  };

  const historyColumns: ColumnsType<HistoryRecord> = [
    { title: '事件', dataIndex: 'eventType', key: 'eventType', width: 130,
      render: (v: string, r: HistoryRecord) => eventTag(v, r.blocked) },
    { title: '档位', dataIndex: 'version', key: 'version', width: 100 },
    { title: '详情', dataIndex: 'detail', key: 'detail', ellipsis: true },
    { title: '操作人', key: 'actor', width: 110, render: (_: unknown, r: HistoryRecord) => {
        const m = r.detail?.match(/by\s+([^\s；]+)/);
        return m ? m[1] : '-';
      } },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
  ];

  if (!isAdmin) {
    return (
      <div className="admin-denied">
        <div className="admin-denied-icon">🔒</div>
        <h2>无权限访问</h2>
        <p>此页面仅限管理员访问</p>
        <Button className="glass-btn" onClick={() => navigate('/editor')}>
          返回首页
        </Button>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <nav className="admin-nav">
        <div className="admin-nav-left">
          <button className="admin-nav-back" onClick={() => navigate('/editor')} title="返回">
            <ArrowLeftOutlined />
          </button>
          <span className="admin-nav-title">Skill 安全档位</span>
          {data && (
            <span className={`ssp-badge ssp-badge-${data.profile.toLowerCase()}`}>
              {data.profileLabel}
            </span>
          )}
          {data && !data.presetMatches && <Tag color="orange">已逐项微调</Tag>}
        </div>
        <div className="admin-nav-right">
          <Button
            danger={!data?.killSwitch}
            type={data?.killSwitch ? 'primary' : 'default'}
            icon={<ThunderboltOutlined />}
            onClick={toggleKillSwitch}
            disabled={!data || busy}
          >
            {data?.killSwitch ? '解除熔断' : '立即熔断'}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchAll} loading={loading}>
            刷新
          </Button>
        </div>
      </nav>

      <div className="admin-body">
        <Spin spinning={loading && !data}>
          {data?.killSwitch && (
            <div className="ssp-banner ssp-banner-danger">
              <ThunderboltOutlined />
              <div>
                <strong>全局熔断已开启</strong>
                <span>所有 skill 执行都会被治理裁决拒绝。若非蓄意为之，请点右上角「解除熔断」。</span>
              </div>
            </div>
          )}

          {data && data.warnings.length > 0 && (
            <div className="ssp-warnings">
              {data.warnings.map((w) => (
                <div className="ssp-warning" key={w.text}>
                  <span className="ssp-warning-dot">!</span>
                  <span>{w.text}</span>
                </div>
              ))}
            </div>
          )}

          <section className="ssp-section">
            <div className="ssp-section-head">
              <h3>安全档位</h3>
              <span className="ssp-section-hint">
                一个档位同时决定阶段一（校验扫描）/ 阶段二（执行隔离）/ 阶段三（治理闭环）的等级
              </span>
            </div>
            <div className="ssp-presets">
              {(data?.presets || []).map((p) => {
                const active = data?.profile === p.name;
                return (
                  <div
                    key={p.name}
                    className={`ssp-preset ssp-preset-${p.name.toLowerCase()} ${active ? 'active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => applyProfile(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') applyProfile(p);
                    }}
                  >
                    <div className="ssp-preset-head">
                      <span className="ssp-preset-name">{p.label}</span>
                      {active && <Tag color="blue">当前生效</Tag>}
                    </div>
                    <p className="ssp-preset-desc">{p.description}</p>
                    <ul className="ssp-preset-facts">
                      <li>
                        <span>沙箱</span>
                        <b>{p.sandboxMode}</b>
                      </li>
                      <li>
                        <span>超时 / 输出</span>
                        <b>{p.sandboxTimeoutSeconds}s / {humanBytes(p.sandboxMaxOutputBytes)}</b>
                      </li>
                      <li>
                        <span>危险模块黑名单</span>
                        <b>{p.forbiddenImportCount} 项</b>
                      </li>
                      <li>
                        <span>危险 import</span>
                        <b>{p.failOnViolation ? '发现即拒绝' : '仅告警'}</b>
                      </li>
                      <li>
                        <span>校验清单</span>
                        <b>{p.requireChecksumManifest ? (p.requireSignedManifest ? '必须有 + 签名' : '必须有') : '不要求'}</b>
                      </li>
                      <li>
                        <span>权限未审批</span>
                        <b>{p.failOnUnapprovedPermission ? '拒绝执行' : '仅告警'}</b>
                      </li>
                      <li>
                        <span>输出契约</span>
                        <b>{p.enforceOutputContract ? '强制' : '不强制'}</b>
                      </li>
                    </ul>
                  </div>
                );
              })}
            </div>
            {data && (
              <div className="ssp-meta">
                最近变更：{data.updatedBy || '—'} · {data.updatedAt || '—'}
                {!data.signingKeyConfigured && ' · 未配置 SKILL_HMAC_SECRET（清单签名无法强制）'}
              </div>
            )}
          </section>

          <section className="ssp-section">
            <div className="ssp-section-head">
              <h3>当前生效值</h3>
              <span className="ssp-section-hint">每一行都是运行时实时读取的值，改完立刻影响下一次执行</span>
            </div>
            <div className="ssp-stages">
              {(data?.stages || []).map((st) => (
                <div className="ssp-stage" key={st.title}>
                  <div className="ssp-stage-title">{st.title}</div>
                  <div className="ssp-stage-items">
                    {st.items.map((it) => (
                      <div className="ssp-knob" key={it.key}>
                        <span className="ssp-knob-label">{it.label}</span>
                        <span className={`ssp-knob-value ${valueClass(it.key, it.value)}`}>
                          {renderValue(it)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="ssp-section">
            <div className="ssp-section-head">
              <h3>变更历史</h3>
              <span className="ssp-section-hint">档位切换与熔断操作全部留痕（来自审计表）</span>
            </div>
            <div className="admin-table-wrap">
              <Table
                dataSource={history}
                columns={historyColumns}
                rowKey={(r) => `${r.createdAt}-${r.eventType}-${r.detail}`}
                loading={loading}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                scroll={{ x: 900 }}
                locale={{ emptyText: '暂无档位变更记录' }}
              />
            </div>
          </section>
        </Spin>
      </div>
    </div>
  );
}
