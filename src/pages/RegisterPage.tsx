import { Form, Input, Button, message } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import type { RegisterRequest } from '../auth/types';

import './RegisterPage.css';

interface FormValues extends RegisterRequest {
  confirmPassword: string;
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register, isLoading } = useAuth();
  const [form] = Form.useForm<FormValues>();

  const handleSubmit = async (values: FormValues) => {
    try {
      const { confirmPassword: _confirmPassword, ...registerData } = values;
      await register(registerData);
      message.success('注册成功');
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '注册失败，请稍后重试';
      message.error(msg);
    }
  };

  return (
    <div className="register-page">
      <div className="register-light-beam" />
      <div className="register-container">
        <div className="register-header">
          <h1 className="register-title">用户注册</h1>
        </div>
        <Form
          form={form}
          layout="vertical"
          className="register-form"
          onFinish={handleSubmit}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, max: 50, message: '用户名长度为3-50个字符' },
            ]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码至少8位' },
            ]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </Form.Item>

          <Form.Item
            name="phone"
            label="手机号"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '请输入有效的11位手机号' },
            ]}
          >
            <Input placeholder="请输入手机号" maxLength={11} />
          </Form.Item>

          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { type: 'email', message: '请输入有效的邮箱格式' },
            ]}
          >
            <Input placeholder="请输入邮箱（选填）" />
          </Form.Item>

          <Form.Item
            name="realName"
            label="真实姓名"
          >
            <Input placeholder="请输入真实姓名（选填）" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={isLoading} block>
              注册
            </Button>
          </Form.Item>
        </Form>

        <div className="register-footer">
          已有账号？
          <Link to="/login">去登录</Link>
        </div>
      </div>
    </div>
  );
}
