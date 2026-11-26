import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AuthProvider } from './auth/AuthContext'
import { setupAuthInterceptor } from './utils/apiClient'
import { antdTheme } from './styles/antdTheme'
import './index.css'
import App from './App.tsx'

setupAuthInterceptor();

// 根级 ConfigProvider：位置在 AuthProvider 内侧、App 外侧。
// 不能放进 App 内部 —— 登录/注册页在 <Routes> 里但在 AuthGuard 外，放进去会漏掉它们，
// 而登录页恰恰是深色玻璃那套最需要跟根主题对齐的地方。
// `button.autoInsertSpace` 也从 LoginPage 提到这里：只在那一个页面关掉，
// 会导致「登 录」紧凑、「注 册」带空格。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider theme={antdTheme} locale={zhCN} button={{ autoInsertSpace: false }}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>,
)
