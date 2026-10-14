import { useEffect, useRef } from 'react';
import { Form, Input, Button, message, ConfigProvider } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import loginBg from '../assets/login-river.mp4';
import './LoginPage.css';

interface LoginFormValues {
  username: string;
  password: string;
}

function LoginPage() {
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);

  // 背景是循环播放的视频，对"减少动态效果"偏好的用户停住第一帧即可
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) v.pause();
  }, []);

  const handleSubmit = async (values: LoginFormValues) => {
    try {
      await login({ username: values.username, password: values.password });
      message.success('登录成功');
      navigate('/editor');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败，请重试';
      message.error(msg);
    }
  };

  return (
    <div className="login-page">
      {/* 背景：长江主题视频（铺满全屏，循环静音） */}
      <video
        ref={videoRef}
        className="login-bg-video"
        src={loginBg}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
      />
      {/* 覆盖层：只在右侧压暗，保证登录卡上的文字对比度；左侧画面保持干净 */}
      <div className="login-scrim" aria-hidden="true" />

      {/* 左上角徽标：以视口左上角为圆心的一块四分之一圆，logo 贴角内嵌（几何约束见 CSS 注释） */}
      <div className="login-corner-badge" aria-hidden="true">
        <img className="login-corner-logo" src="/logo.png" alt="" draggable={false} />
      </div>

      {/* 左上角标题锁版：平台名 + 英文名，紧贴徽标右侧。
          口径复刻登录后平台头部（App.css .nav-logo）：logo 48px、中文名 1.05rem。
          两行文案都必须与 App.tsx 的 .nav-titles **逐字一致**（登录前后同一套名称）：
            中文 = 长江崩岸重点险工段智能风险评估应用平台
            英文 = Yangtze River Bank Collapse Key Hazard Section
                   Intelligent Risk Assessment Platform
          不加底板 —— 直接用深色字写在视频上：这块背景是日落亮天空，
          逐帧实测均值亮度 139.9–140.0（整段视频几乎不变），
          浅色字对比度只有 1.0–3.3，深色 #0F172A 为 5.35，故取深色。 */}
      <div className="login-titlebar">
        <p className="login-title-zh">长江崩岸重点险工段智能风险评估应用平台</p>
        <p className="login-title-en">
          Yangtze River Bank Collapse Key Hazard Section Intelligent Risk Assessment Platform
        </p>
      </div>

      <div className="login-right">
        <div className="login-container">
          <div className="login-inner">
            <div className="login-header">
              <p className="login-welcome-en">Welcome!</p>
              <p className="login-welcome-zh">欢迎！</p>
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

              <Form.Item className="login-submit-item">
                {/* autoInsertSpace=false：antd 默认会在两个汉字之间插一个空格（渲染成「登 录」），
                    挤在 104px 的圆里会显得散，关掉让它紧凑居中 */}
                <ConfigProvider button={{ autoInsertSpace: false }}>
                  <Button
                    className="login-submit"
                    type="primary"
                    htmlType="submit"
                    loading={isLoading}
                  >
                    登录
                  </Button>
                </ConfigProvider>
              </Form.Item>
            </Form>

            <div className="login-footer">
              <span>还没有账号？</span>
              <Link to="/register">立即注册</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
