import { useState, useEffect, useMemo } from 'react';
import { Table, Select, Modal, Button, message, Tag } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, UserOutlined, CrownOutlined, CheckCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { getAccessToken } from '../auth/tokenManager';
import type { UserResponse } from '../auth/types';
import './AdminUserPage.css';

const API_BASE = '/v0/admin';

export default function AdminUserPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState<number | null>(null);

  const isAdmin = user?.role === 'ADMIN';
  const token = getAccessToken();

  const fetchUsers = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UserResponse[] = await res.json();
      setUsers(data);
    } catch {
      message.error('获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.role === 'ADMIN').length;
    const active = users.filter((u) => u.status === 'ACTIVE').length;
    return { total, admins, active };
  }, [users]);

  const handleStatusChange = (targetUser: UserResponse, newStatus: string) => {
    const statusLabel = newStatus === 'ACTIVE' ? '启用' : '禁用';
    Modal.confirm({
      title: '确认操作',
      content: `确定要将用户「${targetUser.username}」的状态修改为「${statusLabel}」吗？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        if (!token) return;
        setUpdating(targetUser.id);
        try {
          const res = await fetch(`${API_BASE}/users/${targetUser.id}/status`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ status: newStatus }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          message.success('状态修改成功');
          fetchUsers();
        } catch {
          message.error('状态修改失败');
        } finally {
          setUpdating(null);
        }
      },
    });
  };

  const handleRoleChange = (targetUser: UserResponse, newRole: string) => {
    const roleLabel = newRole === 'ADMIN' ? '管理员' : '普通用户';
    Modal.confirm({
      title: '确认操作',
      content: `确定要将用户「${targetUser.username}」的角色修改为「${roleLabel}」吗？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        if (!token) return;
        setUpdating(targetUser.id);
        try {
          const res = await fetch(`${API_BASE}/users/${targetUser.id}/role`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ role: newRole }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          message.success('角色修改成功');
          fetchUsers();
        } catch {
          message.error('角色修改失败');
        } finally {
          setUpdating(null);
        }
      },
    });
  };

  const isSelf = (targetUser: UserResponse) => user?.id === targetUser.id;
  const isSuperAdmin = (targetUser: UserResponse) => targetUser.username === 'admin';

  const roleLabel = (role: string, targetUser: UserResponse) => {
    if (role === 'ADMIN' && isSuperAdmin(targetUser)) return '超级管理员';
    return role === 'ADMIN' ? '管理员' : '普通用户';
  };

  const columns: ColumnsType<UserResponse> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 72,
      align: 'center',
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      key: 'phone',
      render: (v: string) => v || <span style={{ color: '#cbd5e1' }}>—</span>,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (v: string) => v || <span style={{ color: '#cbd5e1' }}>—</span>,
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 150,
      render: (role: string, record: UserResponse) => {
        const label = roleLabel(role, record);
        const color = isSuperAdmin(record) ? 'gold' : role === 'ADMIN' ? 'blue' : 'default';

        if (isSelf(record) || isSuperAdmin(record)) {
          return <Tag color={color}>{label}</Tag>;
        }
        return (
          <Select
            value={role}
            popupClassName="admin-select-dropdown"
            style={{ width: 130 }}
            disabled={updating === record.id}
            onChange={(value) => handleRoleChange(record, value)}
            options={[
              { label: '管理员', value: 'ADMIN' },
              { label: '普通用户', value: 'USER' },
            ]}
          />
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status: string, record: UserResponse) => (
        <Select
          value={status}
          popupClassName="admin-select-dropdown"
          style={{ width: 110 }}
          disabled={updating === record.id}
          onChange={(value) => handleStatusChange(record, value)}
          options={[
            { label: '启用', value: 'ACTIVE' },
            { label: '禁用', value: 'INACTIVE' },
          ]}
        />
      ),
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
          <span className="admin-nav-title">用户管理</span>
        </div>
        <div className="admin-nav-right">
          <Button icon={<ReloadOutlined />} onClick={fetchUsers} loading={loading}>
            刷新
          </Button>
        </div>
      </nav>

      <div className="admin-body">
        <div className="admin-stats">
          <div className="admin-stat-card">
            <div className="admin-stat-icon users-icon">
              <UserOutlined />
            </div>
            <div className="admin-stat-info">
              <span className="admin-stat-label">总用户</span>
              <span className="admin-stat-value">{stats.total}</span>
            </div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-icon admin-icon">
              <CrownOutlined />
            </div>
            <div className="admin-stat-info">
              <span className="admin-stat-label">管理员</span>
              <span className="admin-stat-value">{stats.admins}</span>
            </div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-icon active-icon">
              <CheckCircleOutlined />
            </div>
            <div className="admin-stat-info">
              <span className="admin-stat-label">启用中</span>
              <span className="admin-stat-value">{stats.active}</span>
            </div>
          </div>
        </div>

        <div className="admin-table-wrap">
          <Table
            dataSource={users}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 人` }}
            scroll={{ x: 720 }}
          />
        </div>
      </div>
    </div>
  );
}
