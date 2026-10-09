import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Table, Tag, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getAccessToken } from '../auth/tokenManager';
import './AdminUserPage.css';
import './SkillVersionsPage.css';

const API_BASE = '/v0/admin/skill-versions';

type SkillVersionRow = {
  id: number | null;
  skillName: string;
  version: string;
  source: string;
  status: string;
  downloadedAt?: string;
  activatedAt?: string;
  updatedBy?: string;
  updatedAt?: string;
};

const statusTag = (status: string) => {
  if (status === 'ACTIVE') return <Tag color="green">生效中</Tag>;
  if (status === 'RETIRED') return <Tag>已下线</Tag>;
  if (status === 'QUARANTINED') return <Tag color="red">已隔离</Tag>;
  return <Tag>{status}</Tag>;
};

export default function SkillVersionsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = getAccessToken();

  const [rows, setRows] = useState<SkillVersionRow[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(API_BASE, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success === false) {
        message.error(data.error || '加载版本列表失败');
      } else {
        setRows(data.versions || []);
      }
    } catch {
      message.error('加载版本列表失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const call = async (path: string, method: 'POST' | 'DELETE', label: string) => {
    setBusyKey(path);
    try {
      const res = await fetch(path, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        message.success(`${label}成功`);
        fetchAll();
        return true;
      }
      message.error(data.error || `${label}失败`);
    } catch {
      message.error('网络错误');
    } finally {
      setBusyKey(null);
    }
    return false;
  };

  const activate = (row: SkillVersionRow) => {
    Modal.confirm({
      title: '激活该版本？',
      content: `${row.skillName}@${row.version} 将被设为生效版本，同 skill 的原生效版本会自动降级为「已下线」。`,
      okText: '激活',
      cancelText: '取消',
      onOk: () => call(`${API_BASE}/${row.skillName}/${row.version}/activate`, 'POST', '激活'),
    });
  };

  const quarantine = (row: SkillVersionRow) => {
    Modal.confirm({
      title: '隔离该版本？',
      content: `隔离后，${row.skillName}@${row.version} 会被治理裁决拒绝执行——这是"某个版本出问题、先把它按住"的应急手段。`,
      okText: '隔离',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => call(`${API_BASE}/${row.skillName}/${row.version}/quarantine`, 'POST', '隔离'),
    });
  };

  const unquarantine = (row: SkillVersionRow) => {
    Modal.confirm({
      title: '解除隔离？',
      content: `${row.skillName}@${row.version} 将恢复按当前档位参与治理裁决。请确认风险已排除。`,
      okText: '解除隔离',
      cancelText: '取消',
      onOk: () => call(`${API_BASE}/${row.skillName}/${row.version}/unquarantine`, 'POST', '解除隔离'),
    });
  };

  const remove = (row: SkillVersionRow) => {
    Modal.confirm({
      title: '删除该版本记录？',
      content: `将删除 ${row.skillName}@${row.version} 的版本记录（含缓存目录），此操作不可撤销。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => call(`${API_BASE}/${row.skillName}/${row.version}`, 'DELETE', '删除'),
    });
  };

  const stats = useMemo(() => {
    const counter: Record<string, number> = { ACTIVE: 0, RETIRED: 0, QUARANTINED: 0 };
    rows.forEach((r) => {
      counter[r.status] = (counter[r.status] || 0) + 1;
    });
    return counter;
  }, [rows]);

  const filtered = useMemo(() => {
    const kw = filter.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(
      (r) => r.skillName.toLowerCase().includes(kw) || r.version.toLowerCase().includes(kw),
    );
  }, [rows, filter]);

  const columns: ColumnsType<SkillVersionRow> = [
    { title: '技能', dataIndex: 'skillName', key: 'skillName', width: 150 },
    { title: '版本', dataIndex: 'version', key: 'version', width: 110 },
    { title: '来源', dataIndex: 'source', key: 'source', width: 100, render: (v?: string) => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (s: string) => statusTag(s) },
    { title: '下载时间', dataIndex: 'downloadedAt', key: 'downloadedAt', width: 165, render: (v?: string) => v || '-' },
    { title: '激活时间', dataIndex: 'activatedAt', key: 'activatedAt', width: 165, render: (v?: string) => v || '-' },
    { title: '更新人', dataIndex: 'updatedBy', key: 'updatedBy', width: 110, render: (v?: string) => v || '-' },
    {
      title: '操作',
      key: 'action',
      width: 230,
      fixed: 'right',
      render: (_: unknown, row: SkillVersionRow) => {
        const key = `${row.skillName}@${row.version}`;
        const loading = busyKey?.startsWith(`${API_BASE}/${row.skillName}/${row.version}`) || false;
        return (
          <div className="svp-actions">
            {row.status !== 'ACTIVE' && row.status !== 'QUARANTINED' && (
              <Button size="small" type="primary" loading={loading} onClick={() => activate(row)}>
                激活
              </Button>
            )}
            {row.status === 'QUARANTINED' ? (
              <Button size="small" loading={loading} onClick={() => unquarantine(row)}>
                解除隔离
              </Button>
            ) : (
              <Button size="small" danger loading={loading} onClick={() => quarantine(row)}>
                隔离
              </Button>
            )}
            <Button size="small" type="text" danger onClick={() => remove(row)} title={`删除 ${key}`}>
              删除
            </Button>
          </div>
        );
      },
    },
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
          <span className="admin-nav-title">Skill 版本与隔离</span>
        </div>
        <div className="admin-nav-right">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="按技能名 / 版本筛选"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 220 }}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchAll} loading={loading}>
            刷新
          </Button>
        </div>
      </nav>

      <div className="admin-body">
        <div className="admin-stats">
          <div className="admin-stat-card">
            <div className="admin-stat-icon active-icon">✓</div>
            <div className="admin-stat-info">
              <span className="admin-stat-label">生效中</span>
              <span className="admin-stat-value">{stats.ACTIVE || 0}</span>
            </div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-icon users-icon">↓</div>
            <div className="admin-stat-info">
              <span className="admin-stat-label">已下线</span>
              <span className="admin-stat-value">{stats.RETIRED || 0}</span>
            </div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-icon admin-icon">!</div>
            <div className="admin-stat-info">
              <span className="admin-stat-label">已隔离</span>
              <span className="admin-stat-value">{stats.QUARANTINED || 0}</span>
            </div>
          </div>
        </div>

        <div className="svp-hint">
          隔离是把某个 <code>skill@version</code> 单独按住的应急手段，与
          <strong> 安全档位页 </strong>
          的全局熔断互补：熔断停掉一切，隔离只停一个版本。两者都由治理裁决强制执行。
        </div>

        <div className="admin-table-wrap">
          <Table
            dataSource={filtered}
            columns={columns}
            rowKey={(r) => `${r.skillName}@${r.version}`}
            loading={loading}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            scroll={{ x: 1080 }}
            locale={{ emptyText: '暂无版本记录' }}
          />
        </div>
      </div>
    </div>
  );
}
