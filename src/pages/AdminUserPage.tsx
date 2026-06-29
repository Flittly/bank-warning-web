import { useState, useEffect } from 'react';
import { Table, Select, Modal, Button, message, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../auth/useAuth';
import { getAccessToken } from '../auth/tokenManager';
import type { UserResponse } from '../auth/types';

const API_BASE = '/v0/admin';

export default function AdminUserPage() {
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
    } catch (e) {
      message.error('获取用户列表失败');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

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
        } catch (e) {
          message.error('状态修改失败');
          console.error(e);
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
        } catch (e) {
          message.error('角色修改失败');
          console.error(e);
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
      width: 80,
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
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string, record: UserResponse) => {
        const label = roleLabel(role, record);
        const color = isSuperAdmin(record) ? 'gold' : role === 'ADMIN' ? 'blue' : 'default';

        if (isSelf(record) || isSuperAdmin(record)) {
          return <Tag color={color}>{label}</Tag>;
        }
        return (
          <Select
            value={role}
            style={{
              width: 130,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
            }}
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
      render: (status: string, record: UserResponse) => (
        <Select
          value={status}
          style={{ width: 120 }}
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
      <div style={{ padding: 48, textAlign: 'center' }}>
        <h2>无权限访问</h2>
        <p>此页面仅限管理员访问</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>用户管理</h2>
        <Button onClick={fetchUsers} loading={loading}>刷新</Button>
      </div>
      <Table
        dataSource={users}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />
    </div>
  );
}
