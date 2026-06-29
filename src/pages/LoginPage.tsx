import { useEffect, useRef } from 'react';
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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let w = 0;
    let h = 0;

    const rivers: { points: number[]; offset: number; speed: number; width: number; alpha: number; hue: number }[] = [];

    function genRiverPath(yBase: number, amplitude: number, segments: number) {
      const pts: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const x = (i / segments) * w;
        const y = yBase + Math.sin(i * 0.3) * amplitude * 0.3
                + Math.sin(i * 0.13) * amplitude * 0.5
                + Math.cos(i * 0.09) * amplitude * 0.3;
        pts.push(x, y);
      }
      return pts;
    }

    function init() {
      w = canvas!.width = canvas!.offsetWidth * (window.devicePixelRatio || 1);
      h = canvas!.height = canvas!.offsetHeight * (window.devicePixelRatio || 1);
      ctx!.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
      const cw = canvas!.offsetWidth;
      const ch = canvas!.offsetHeight;

      rivers.length = 0;
      rivers.push({ points: genRiverPath(ch * 0.34, 50, 60), offset: 0, speed: 0.4, width: 2.2, alpha: 0.5, hue: 200 });
      rivers.push({ points: genRiverPath(ch * 0.40, 55, 60), offset: 0.5, speed: 0.32, width: 1.8, alpha: 0.4, hue: 210 });
      rivers.push({ points: genRiverPath(ch * 0.46, 50, 60), offset: 1.0, speed: 0.36, width: 1.5, alpha: 0.45, hue: 195 });
      rivers.push({ points: genRiverPath(ch * 0.52, 45, 60), offset: 0.3, speed: 0.28, width: 1.2, alpha: 0.35, hue: 220 });
      rivers.push({ points: genRiverPath(ch * 0.58, 40, 60), offset: 0.7, speed: 0.44, width: 2.4, alpha: 0.45, hue: 205 });
      rivers.push({ points: genRiverPath(ch * 0.64, 30, 60), offset: 0.9, speed: 0.38, width: 3, alpha: 0.65, hue: 0 });
    }
    init();

    function draw() {
      if (!ctx || !canvas) return;
      const cw = canvas.offsetWidth;
      const ch = canvas.offsetHeight;
      ctx.clearRect(0, 0, cw, ch);
      const t = performance.now() * 0.001;

      for (const river of rivers) {
        ctx.save();
        ctx.beginPath();
        const pts = river.points;
        for (let i = 2; i < pts.length; i += 2) {
          const px = pts[i - 2];
          const py = pts[i - 1] + Math.sin(t * river.speed + i * 0.04 + river.offset) * 8;
          const cx = (pts[i - 2] + pts[i]) / 2;
          const cy = (pts[i - 1] + pts[i + 1]) / 2 + Math.sin(t * river.speed + (i + 1) * 0.04 + river.offset) * 8;
          const nx = pts[i];
          const ny = pts[i + 1] + Math.sin(t * river.speed + (i + 2) * 0.04 + river.offset) * 8;

          if (i === 2) ctx.moveTo(px, py);
          ctx.quadraticCurveTo(cx, cy, nx, ny);
        }

        // glow stroke
        ctx.strokeStyle = `hsla(${river.hue}, 60%, 70%, ${river.alpha * 0.3})`;
        ctx.lineWidth = river.width + 8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // core stroke
        ctx.strokeStyle = `hsla(${river.hue}, 60%, 75%, ${river.alpha})`;
        ctx.lineWidth = river.width;
        ctx.stroke();

        ctx.restore();
      }

      animId = requestAnimationFrame(draw);
    }
    draw();

    const onResize = () => init();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const handleSubmit = async (values: LoginFormValues) => {
    try {
      await login({ username: values.username, password: values.password });
      message.success('登录成功');
      navigate('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败，请重试';
      message.error(msg);
    }
  };

  return (
    <div className="login-page">
      {/* 左侧：长江动态曲线 */}
      <div className="login-left">
        <div className="left-card">
          <canvas ref={canvasRef} className="left-canvas" />
          <div className="left-overlay">
            <span className="left-title">长江</span>
          </div>
        </div>
      </div>

      {/* 右侧：登录表单（50% 居中） */}
      <div className="login-right">
        <div className="login-container">
          <div className="login-header">
            <p className="login-welcome-en">Welcome!</p>
            <p className="login-welcome-zh">欢迎！</p>
            <p className="login-brand">长江崩岸监测预警应用系统</p>
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
              <Button type="primary" htmlType="submit" block loading={isLoading}>
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
    </div>
  );
}

export default LoginPage;
