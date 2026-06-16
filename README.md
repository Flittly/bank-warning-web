<div align="center">

# 🗺️ 长江河岸崩塌风险评估系统 — 前端应用

**Yangtze River Bank Collapse Risk Assessment System — Frontend Web Application**

基于 React 19 + TypeScript + Vite + Mapbox GL JS 的单页应用，提供断面编辑、地图可视化、AI 对话分析和报告管理功能。

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Mapbox GL JS](https://img.shields.io/badge/Mapbox%20GL%20JS-3.19-4264FB?style=flat-square&logo=mapbox&logoColor=white)](https://docs.mapbox.com/mapbox-gl-js/)
[![React Router](https://img.shields.io/badge/React%20Router-7-CA4245?style=flat-square&logo=reactrouter&logoColor=white)](https://reactrouter.com/)

</div>

---

## 📖 目录 / Table of Contents

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [页面与功能](#页面与功能)
- [License](#license)

---

## 项目简介

`bank-warning-web` 是长江河岸崩塌风险评估系统的 React 前端应用，负责：

- 断面编辑工具：Mapbox 地图上交互式绘制、拖拽、编辑断面线
- 任务管理面板：创建/查看/运行风险评估任务
- 结果查看器：风险等级可视化、指标分解展示、地图叠加分析
- AI 对话助手：ReAct 智能体对话、知识检索（RAG）、自动报告生成
- 报告工作区：多标签 Markdown 报告查看、编辑、保存
- 可拖拽布局：左侧栏、地图区、右侧 AI 聊天面板均支持拖拽调整大小

---

## 核心特性

| 特性 | 说明 |
|------|------|
| **Mapbox 地图编辑** | 支持在卫星/街道底图上交互式绘制断面线，拖拽调整端点位置 |
| **Turf.js 空间分析** | 使用 @turf/turf 进行缓冲区计算、垂线生成、距离测量等地理空间运算 |
| **三栏可拖拽布局** | 左侧边栏、地图区、右侧 AI 聊天面板均支持鼠标拖拽调整宽度 |
| **AI 对话面板** | 集成 AgentScope ReAct 智能体，支持自然语言查询风险数据、天气预报、知识检索 |
| **报告管理** | 多标签工作区，Markdown 渲染（react-markdown + remark-gfm），支持在线编辑保存 |
| **风险可视化** | 风险等级图表、颜色编码断面、指标分布图表 |
| **RustFS 文件集成** | 断面数据导出/导入，TIFF 地形的上传与管理 |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | React 19 + TypeScript 5.9 |
| **构建工具** | Vite 7 |
| **地图** | Mapbox GL JS 3.19 |
| **空间分析** | @turf/turf 7.3 |
| **路由** | React Router 7 |
| **Markdown** | react-markdown 10 + remark-gfm |
| **图标** | lucide-react 1.0 |
| **代码检查** | ESLint 9 + typescript-eslint |

---

## 项目结构

```
bank-warning-web/
├── public/                          # 静态资源
├── src/
│   ├── assets/                      # 图片、字体等静态资源
│   ├── components/                  # 通用组件
│   │   ├── ChatPanel.tsx            # AI 对话面板
│   │   ├── EditorMap.tsx            # Mapbox 地图封装（绘制/编辑/拖拽断面）
│   │   ├── ResizeHandle.tsx         # 水平拖拽条组件
│   │   ├── VerticalResizeHandle.tsx # 垂直拖拽条组件
│   │   └── WorkspacePanel.tsx       # 报告工作区（多标签）
│   ├── pages/                       # 页面组件
│   │   ├── EditorPage.tsx           # 断面编辑器页面
│   │   ├── EditorSidebar.tsx        # 编辑器左侧栏
│   │   └── ResultPage.tsx           # 结果查看器页面
│   ├── services/                    # API 服务层
│   ├── types/                       # TypeScript 类型定义
│   ├── utils/                       # 工具函数
│   ├── App.tsx                      # 根组件 + 路由
│   ├── App.css                      # 全局样式
│   └── main.tsx                     # 入口文件
├── index.html                       # HTML 模板
├── package.json                     # 依赖与脚本
├── tsconfig.json                    # TypeScript 配置
└── vite.config.ts                   # Vite 构建配置
```

---

## 快速开始

### 前置条件

- **Node.js 18+**
- **Mapbox Access Token**（[免费注册](https://account.mapbox.com/auth/signup/)）
- **后端服务**（`bank-warning-server` 运行在 `localhost:8090`）

### 1. 克隆项目

```bash
git clone <repository-url>
cd bank-warning-web
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 Mapbox Token

在项目根目录创建 `.env` 文件：

```env
VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_token_here
```

### 4. 启动开发服务器

```bash
npm run dev
```

浏览器访问 `http://localhost:5173`

### 5. 构建生产版本

```bash
npm run build
npm run preview
```

---

## 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `VITE_MAPBOX_ACCESS_TOKEN` | — | Mapbox GL JS 访问令牌（必填） |
| `VITE_API_BASE_URL` | `http://localhost:8090` | 后端 API 基础地址 |

### 可执行脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（HMR 热更新） |
| `npm run build` | TypeScript 检查 + Vite 生产构建 |
| `npm run lint` | ESLint 代码检查 |
| `npm run preview` | 预览生产构建结果 |

---

## 页面与功能

### 1. 首页

- 项目标题与简介展示
- 导航入口：进入编辑器 / 查看结果

### 2. 断面编辑器（EditorPage）

- **左侧栏**：断面列表、参数配置
- **地图区**：Mapbox 交互式地图，支持：
  - 点击绘制断面线
  - 拖拽移动断面端点
  - 显示垂线标注
  - GeoJSON 数据导入
- **右侧 AI 面板**：ReAct 智能体对话
- **可拖拽布局**：所有面板宽度均可通过拖拽条调整

### 3. 结果查看器（ResultPage）

- **左侧栏**：任务列表、断面树形导航
- **地图区**：风险等级覆盖显示
  - 颜色编码断面（绿/黄/橙/红 = 低/中/高/极高）
  - 风险详情弹窗
- **底部报告工作区**：多标签页
  - Markdown 渲染报告
  - 在线编辑与保存
  - 高度可拖拽调整
- **右侧 AI 面板**：智能体对话与报告生成

---

## 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                        bank-warning-web                      │
│                                                            │
│  ┌─────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐  │
│  │侧边栏│  │   Mapbox 地图  │  │  AI 聊天面板  │  │ 报告标签 │  │
│  │     │  │  (EditorMap)  │  │ (ChatPanel)  │  │  (Workspace ) │
│  │     │  │              │  │              │  │  Panel)   │  │
│  │列表/参│  │ · 绘制断面   │  │ · ReAct 对话  │  │ · Markdown │ │
│  │数配置 │  │ · 拖拽编辑   │  │ · 知识检索   │  │ · 在线编辑 │ │
│  │     │  │ · 风险叠加   │  │ · 报告生成   │  │ · 多标签页 │ │
│  └─────┘  └──────────────┘  └──────────────┘  └─────────┘  │
│       ↕ ResizeHandle        ↕ ResizeHandle        ↕ Vertical  │
│         (水平拖拽)            (水平拖拽)          ResizeHandle │
│                                                  (垂直拖拽)   │
└──────────────────────────────────────────────────────────────┘
         │                     │
         ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│  Java 后端服务    │   │  Python 模型服务  │
│  (Port 8090)    │   │  (Port 8088)    │
└─────────────────┘   └─────────────────┘
```

---

## License

本项目仅供学术研究使用。

---

<div align="center">

**[English Version](#english-version)**

</div>

---

<a id="english-version"></a>

# 🗺️ Yangtze River Bank Collapse Risk Assessment System — Frontend Application

A single-page application built with React 19 + TypeScript + Vite + Mapbox GL JS, providing section editing, map visualization, AI chat analysis, and report management.

## Table of Contents

- [Introduction](#introduction-en)
- [Features](#features-en)
- [Tech Stack](#tech-stack-en)
- [Project Structure](#project-structure-en)
- [Getting Started](#getting-started-en)
- [Configuration](#configuration-en)
- [Pages & Features](#pages--features-en)
- [Architecture](#architecture-en)
- [License](#license-en)

---

<a id="introduction-en"></a>

## Introduction

`bank-warning-web` is the React frontend for the Yangtze River Bank Collapse Risk Assessment System. It handles:

- Section editor: interactive drawing, dragging, and editing of cross-section lines on Mapbox
- Task management panel: create/view/run risk assessment tasks
- Result viewer: risk level visualization, indicator breakdown, map overlay analysis
- AI chat assistant: ReAct agent conversation, knowledge retrieval (RAG), automated report generation
- Report workspace: multi-tab Markdown report viewing, editing, and saving
- Draggable layout: left sidebar, map area, and right AI chat panel are all resizable via drag handles

---

<a id="features-en"></a>

## Features

| Feature | Description |
|---------|-------------|
| **Mapbox Map Editing** | Interactive cross-section line drawing on satellite/street basemaps with draggable endpoints |
| **Turf.js Spatial Analysis** | Buffer computation, perpendicular line generation, distance measurement via @turf/turf |
| **Three-Column Draggable Layout** | Left sidebar, map area, and right AI chat panel are all resizable via mouse drag |
| **AI Chat Panel** | Integrated AgentScope ReAct agent for natural language queries on risk data, weather, and knowledge bases |
| **Report Management** | Multi-tab workspace with Markdown rendering (react-markdown + remark-gfm) and inline editing |
| **Risk Visualization** | Risk level charts, color-coded sections, indicator distribution displays |
| **RustFS File Integration** | Section data export/import, TIFF terrain upload and management |

---

<a id="tech-stack-en"></a>

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | React 19 + TypeScript 5.9 |
| **Build Tool** | Vite 7 |
| **Map** | Mapbox GL JS 3.19 |
| **Spatial Analysis** | @turf/turf 7.3 |
| **Routing** | React Router 7 |
| **Markdown** | react-markdown 10 + remark-gfm |
| **Icons** | lucide-react 1.0 |
| **Linting** | ESLint 9 + typescript-eslint |

---

<a id="project-structure-en"></a>

## Project Structure

```
bank-warning-web/
├── public/                          # Static assets
├── src/
│   ├── assets/                      # Images, fonts, etc.
│   ├── components/                  # Reusable components
│   │   ├── ChatPanel.tsx            # AI chat panel
│   │   ├── EditorMap.tsx            # Mapbox map wrapper (draw/edit/drag sections)
│   │   ├── ResizeHandle.tsx         # Horizontal resize handle
│   │   ├── VerticalResizeHandle.tsx # Vertical resize handle
│   │   └── WorkspacePanel.tsx       # Report workspace (multi-tab)
│   ├── pages/                       # Page components
│   │   ├── EditorPage.tsx           # Section editor page
│   │   ├── EditorSidebar.tsx        # Editor left sidebar
│   │   └── ResultPage.tsx           # Result viewer page
│   ├── services/                    # API service layer
│   ├── types/                       # TypeScript type definitions
│   ├── utils/                       # Utility functions
│   ├── App.tsx                      # Root component + routing
│   ├── App.css                      # Global styles
│   └── main.tsx                     # Entry point
├── index.html                       # HTML template
├── package.json                     # Dependencies and scripts
├── tsconfig.json                    # TypeScript configuration
└── vite.config.ts                   # Vite build configuration
```

---

<a id="getting-started-en"></a>

## Getting Started

### Prerequisites

- **Node.js 18+**
- **Mapbox Access Token** ([free registration](https://account.mapbox.com/auth/signup/))
- **Backend service** (`bank-warning-server` running at `localhost:8090`)

### 1. Clone the Repository

```bash
git clone <repository-url>
cd bank-warning-web
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Mapbox Token

Create a `.env` file in the project root:

```env
VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_token_here
```

### 4. Start Dev Server

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### 5. Build for Production

```bash
npm run build
npm run preview
```

---

<a id="configuration-en"></a>

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_MAPBOX_ACCESS_TOKEN` | — | Mapbox GL JS access token (required) |
| `VITE_API_BASE_URL` | `http://localhost:8090` | Backend API base URL |

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | TypeScript check + Vite production build |
| `npm run lint` | ESLint code linting |
| `npm run preview` | Preview production build |

---

<a id="pages--features-en"></a>

## Pages & Features

### 1. Home Page

- Project title and introduction display
- Navigation: Enter Editor / View Results

### 2. Section Editor (EditorPage)

- **Left panel**: section list, parameter configuration
- **Map area**: Mapbox interactive map with:
  - Click-to-draw cross-section lines
  - Drag-to-move section endpoints
  - Perpendicular line annotations
  - GeoJSON import
- **Right AI panel**: ReAct agent conversation
- **Draggable layout**: all panel widths are adjustable via drag handles

### 3. Result Viewer (ResultPage)

- **Left panel**: task list, section tree navigation
- **Map area**: risk level overlay display
  - Color-coded sections (Green/Yellow/Orange/Red = Low/Medium/High/Critical)
  - Risk detail popups
- **Bottom report workspace**: multi-tab
  - Markdown rendered reports
  - Online editing and saving
  - Height adjustable via drag
- **Right AI panel**: agent conversation and report generation

---

<a id="architecture-en"></a>

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        bank-warning-web                      │
│                                                            │
│  ┌─────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────┐  │
│  │Sidebar│  │  Mapbox Map  │  │ AI Chat Panel│  │  Report  │  │
│  │      │  │ (EditorMap)  │  │  (ChatPanel) │  │  Tabs    │  │
│  │      │  │              │  │              │  │(Workspace)  │
│  │List/  │  │ · Draw       │  │ · ReAct Chat │  │ Panel)   │  │
│  │Config │  │ · Edit       │  │ · RAG Search │  │ · Markdown│  │
│  │      │  │ · Overlay    │  │ · Reports   │  │ · Edit    │  │
│  └─────┘  └──────────────┘  └──────────────┘  └─────────┘  │
│       ↕ ResizeHandle        ↕ ResizeHandle        ↕ Vertical  │
│        (horizontal)          (horizontal)       ResizeHandle │
│                                                  (vertical)   │
└──────────────────────────────────────────────────────────────┘
         │                     │
         ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│  Java Backend   │   │  Python Model   │
│  (Port 8090)    │   │  (Port 8088)    │
└─────────────────┘   └─────────────────┘
```

---

<a id="license-en"></a>

## License

This project is for academic research purposes only.
