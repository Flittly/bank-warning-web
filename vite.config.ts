import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 将所有 /v0 前缀的请求代理到后端开发服务
      '/v0': {
        target: 'http://192.168.1.104:8090',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
