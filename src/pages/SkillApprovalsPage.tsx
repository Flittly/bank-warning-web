import { useEffect, useState } from 'react';
import { Table, Tabs, Button, Tag, Modal, Input, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getAccessToken } from '../auth/tokenManager';
import './AdminUserPage.css';

const API_BASE = '/v0/admin/skill-governance';

type Approval = {
  id: number;
  skillName: string;
  version: string;
  permission: string;
  status: string;
  requestedBy?: string;
  reviewedBy?: string;
  comment?: string;
};

type AuditRecord = {
  skillName: string;
  version: string;
  eventType: string;
  detail: string;
  blocked: boolean;
  createdAt: string;
};

const statusTag = (status: string) => {
  if (status === 'APPROVED') return <Tag color="green">已批准</Tag>;
  if (status === 'PENDING') return <Tag color="orange">待审批</Tag>;
  if (status === 'REJECTED') return <Tag color="red">已驳回</Tag>;
  return <Tag>未申请</Tag>;
};

export default function SkillApprovalsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pending, setPending] = useState<Approval[]>([]);
  const [all, setAll] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<Approval | null>(null);
  const [comment, setComment] = useState('');

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const token = getAccessToken();

  const fetchAll = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [p, a, au] = await Promise.all([
        fetch(`${API_BASE}/approvals?status=PENDING`).then((r) => r.json()),
        fetch(`${API_BASE}/approvals?status=ALL`).then((r) => r.json()),
        fetch(`${API_BASE}/audit?limit=200`).then((r) => r.json()),
      ]);
      setPending(p.approvals || []);
      setAll(a.approvals || []);
      setAudit(au.audit || []);
    } catch {
      message.error('加载审批数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const post = async (path: string, body?: Record<string, string>) => {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (data.success) {
        message.success('操作成功');
        fetchAll();
        return true;
      }
      message.error(data.error || '操作失败');
    } catch {
      message.error('网络错误');
    }
    return false;
  };

  const approve = (row: Approval) => {
    Modal.confirm({
      title: '批准审批',
      content: `批准 ${row.skillName}@${row.version} 使用权限「${row.permission}」？`,
      okText: '批准',
      cancelText: '取消',
      onOk: () => post(`${API_BASE}/approvals/${row.id}/approve`),
    });
  };

  const resubmit = (row: Approval) => {
    Modal.confirm({
      title: '重新提交',
      content: `将 ${row.skillName}@${row.version} 的权限「${row.permission}」重新提交审批？`,
      okText: '重新提交',
      cancelText: '取消',
      onOk: () => post(`${API_BASE}/approvals/${row.id}/resubmit`),
    });
  };

  const confirmReject = () => {
    if (!rejectTarget) return;
    post(`${API_BASE}/approvals/${rejectTarget.id}/reject`, { comment });
    setRejectTarget(null);
    setComment('');
  };

  const pendingColumns: ColumnsType<Approval> = [
    { title: '技能', dataIndex: 'skillName', key: 'skillName' },
    { title: '版本', dataIndex: 'version', key: 'version', width: 90 },
    { title: '权限', dataIndex: 'permission', key: 'permission', width: 120 },
    { title: '申请者', dataIndex: 'requestedBy', key: 'requestedBy', width: 110 },
    {
      title: '操作',
      key: 'action',
      width: 170,
      render: (_: unknown, record: Approval) => (
        <>
          <Button type="primary" size="small" style={{ marginRight: 6 }} onClick={() => approve(record)}>
            批准
          </Button>
          <Button danger size="small" onClick={() => setRejectTarget(record)}>
            驳回
          </Button>
        </>
      ),
    },
  ];

  const allColumns: ColumnsType<Approval> = [
    { title: '技能', dataIndex: 'skillName', key: 'skillName' },
    { title: '版本', dataIndex: 'version', key: 'version', width: 90 },
    { title: '权限', dataIndex: 'permission', key: 'permission', width: 120 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (s: string) => statusTag(s) },
    { title: '申请者', dataIndex: 'requestedBy', key: 'requestedBy', width: 110 },
    { title: '审批人', dataIndex: 'reviewedBy', key: 'reviewedBy', width: 110, render: (v?: string) => v || '-' },
    { title: '意见', dataIndex: 'comment', key: 'comment', ellipsis: true, render: (v?: string) => v || '-' },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: Approval) => (
        <>
          {record.status === 'PENDING' && (
            <Button type="primary" size="small" style={{ marginRight: 6 }} onClick={() => approve(record)}>
              批准
            </Button>
          )}
          {record.status === 'REJECTED' && (
            <Button size="small" onClick={() => resubmit(record)}>
              重新提交
            </Button>
          )}
        </>
      ),
    },
  ];

  const auditColumns: ColumnsType<AuditRecord> = [
    { title: '技能', dataIndex: 'skillName', key: 'skillName' },
    { title: '版本', dataIndex: 'version', key: 'version', width: 90 },
    { title: '事件', dataIndex: 'eventType', key: 'eventType', width: 150 },
    { title: '详情', dataIndex: 'detail', key: 'detail', ellipsis: true },
    {
      title: '拦截',
      dataIndex: 'blocked',
      key: 'blocked',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="red">是</Tag> : <Tag color="green">否</Tag>),
    },
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
          <span className="admin-nav-title">Skill 审批</span>
        </div>
        <div className="admin-nav-right">
          <Button icon={<ReloadOutlined />} onClick={fetchAll} loading={loading}>
            刷新
          </Button>
        </div>
      </nav>

      <div className="admin-body">
        <div className="admin-table-wrap">
          <Tabs
            items={[
              {
                key: 'pending',
                label: `待审批${pending.length ? ` (${pending.length})` : ''}`,
                children: (
                  <Table
                    dataSource={pending}
                    columns={pendingColumns}
                    rowKey="id"
                    loading={loading}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    scroll={{ x: 720 }}
                  />
                ),
              },
              {
                key: 'all',
                label: '全部记录',
                children: (
                  <Table
                    dataSource={all}
                    columns={allColumns}
                    rowKey="id"
                    loading={loading}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    scroll={{ x: 900 }}
                  />
                ),
              },
              {
                key: 'audit',
                label: '审计日志',
                children: (
                  <Table
                    dataSource={audit}
                    columns={auditColumns}
                    rowKey={(r) => `${r.createdAt}-${r.eventType}-${r.skillName}`}
                    loading={loading}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    scroll={{ x: 900 }}
                  />
                ),
              },
            ]}
          />
        </div>
      </div>

      <Modal
        title="驳回审批"
        open={!!rejectTarget}
        onOk={confirmReject}
        onCancel={() => {
          setRejectTarget(null);
          setComment('');
        }}
        okText="驳回"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p>
          驳回 {rejectTarget?.skillName}@{rejectTarget?.version} 的权限「{rejectTarget?.permission}」
        </p>
        <Input.TextArea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="驳回意见（选填）"
        />
      </Modal>
    </div>
  );
}
