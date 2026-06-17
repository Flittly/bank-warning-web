import { Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import type { LoginRequest } from '../auth/types';
import './LoginPage.css';

interface LoginFormValues {
  username: string;
  password: string;
}

function LoginPage() {
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (values: LoginFormValues) => {
    try {
      const request: LoginRequest = {
        username: values.username,
        password: values.password,
      };
      await login(request);
      message.success('登录成功');
      navigate('/');
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : '登录失败，请重试';
      message.error(errorMessage);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <h1 className="login-title">崩岸分析系统</h1>
          <p className="login-subtitle">Bank Line Analysis System</p>
        </div>

        <Form
          name="login"
          className="login-form"
          onFinish={handleSubmit}
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="用户名"
              autoComplete="username"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={isLoading}
            >
              登录
            </Button>
          </Form.Item>
        </Form>

        <div className="login-footer">
          <span>还没有账号？</span>
          <Link to="/register">立即注册</Link>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
