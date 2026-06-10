# BankCalculator 文件功能说明

本文用于说明当前前端工程的主要目录结构、各文件职责，以及哪些文件属于 legacy/备用代码，避免后续重构再次“同一系统拆到多个文件/重复实现”。

> 约定：
> - **页面壳**：主要负责 state + 组件组装 + 调用 actions。
> - **actions/api**：与后端交互、几何计算、断面 CRUD 等“业务动作”。
> - **types**：跨模块共享的类型定义。

---

## 入口与全局

- [index.html](index.html)
  - Vite 入口 HTML。
- [src/main.tsx](src/main.tsx)
  - React 渲染入口；使用 `BrowserRouter` 包裹，但当前页面切换主要由 `App` 内部 state 控制。
- [src/App.tsx](src/App.tsx)
  - 顶层导航与页面切换（`home` / `editor` / `result`）。
- [src/App.css](src/App.css)
  - 全局样式 + 结果页/进度条等样式。
- [src/index.css](src/index.css)
  - 全局基础样式。

---

## 页面（pages）

- [src/pages/HomePage.tsx](src/pages/HomePage.tsx)
  - 首页。
- [src/pages/ResultPage.tsx](src/pages/ResultPage.tsx)
  - 结果查看页。
- [src/pages/EditorPage.tsx](src/pages/EditorPage.tsx)
  - **断面编辑器页面壳**：
    - 维护编辑器相关 state（上传数据、断面数据、选择状态、全局参数、分组等）。
    - 负责把 state/handlers 以 props 形式传给 `EditorMap` / `EditorSidebar`。
    - 业务动作（断面 CRUD、创建任务、导入导出等）已下沉到 [src/pages/editor](src/pages/editor) 下的模块。

### Editor 子模块（业务动作/后端交互）

目录：[src/pages/editor](src/pages/editor)

- [src/pages/editor/taskState.ts](src/pages/editor/taskState.ts)
  - 当前任务 ID 的简单模块级存储（`getCurrentTaskId`/`setCurrentTaskId`）。
  - 供“生成断面/导入断面/新建断面/运行任务”等动作共享。
- [src/pages/editor/sectionApi.ts](src/pages/editor/sectionApi.ts)
  - 后端断面参数读取（`GET /v0/bank/sections/{id}`）并映射到 `SectionParams`。
- [src/pages/editor/basicParamsApi.ts](src/pages/editor/basicParamsApi.ts)
  - 基础参数模板列表与详情：
    - `fetchBasicParamsList()`：拉取模板列表。
    - `fetchBasicParamDetailAsSectionParams()`：拉取模板详情并映射为 `SectionParams`。
- [src/pages/editor/sectionsGeneration.ts](src/pages/editor/sectionsGeneration.ts)
  - “生成断面并创建任务”的主流程：
    - 创建任务：`POST /v0/bank/tasks`
    - 按岸线生成断面几何：复用 [src/utils/geometry.ts](src/utils/geometry.ts)
    - 创建断面：`POST /v0/bank/sections`
    - `runCurrentTask()`：运行任务 `POST /v0/bank/tasks/{taskId}/run`
- [src/pages/editor/crossLineActions.ts](src/pages/editor/crossLineActions.ts)
  - 单条断面（cross line）动作：
    - 反转、删除、新建、平移、打开属性配置（后端同步时走 `/v0/bank/sections/{id}`）。
- [src/pages/editor/customSegments.ts](src/pages/editor/customSegments.ts)
  - “自定义组应用配置”逻辑：
    - 未修改间距：只调整长度。
    - 修改间距：删除原段断面并按新间距重绘。
- [src/pages/editor/fileActions.ts](src/pages/editor/fileActions.ts)
  - 文件相关动作：
    - 上传主线 GeoJSON：仅前端加载（不再调用已弃用的 `/v0/mi/geojson`）
    - 岸段管理（发送/获取/删除）：`/v0/bank/banks`
    - 导入断面 GeoJSON 并创建任务+断面：`POST /v0/bank/tasks` + `POST /v0/bank/sections`
    - 导出断面样例 GeoJSON。

---

## 组件（components）

目录：[src/components](src/components)

- [src/components/EditorMap.tsx](src/components/EditorMap.tsx)
  - Mapbox 地图展示与交互层：
    - 渲染主线/断面/高亮。
    - 负责鼠标点击选择岸段、选择起止点、选择断面、以及新建断面（通过 props 调用页面 action）。
- [src/components/EditorSidebar.tsx](src/components/EditorSidebar.tsx)
  - 编辑器侧边栏 UI：
    - 上传/导入/导出按钮。
    - 全局间距/长度设置。
    - 模式切换（岸段选择、起止点选择、断面选择）。
    - 自定义组列表与配置入口。
    - 断面操作（平移/反转/删除/属性）。
  - 类型说明：已统一使用 [src/types/selection.ts](src/types/selection.ts) 中的 `SelectionGroup`。
- [src/components/EditorSidebar.module.css](src/components/EditorSidebar.module.css)
  - 侧边栏样式（CSS Modules）。
- [src/components/SectionPropertiesModal.tsx](src/components/SectionPropertiesModal.tsx)
  - 断面/组的 `SectionParams` 编辑弹窗，并可选同步到后端 `PUT /v0/bank/sections/{id}`。
- [src/components/PropertiesModal.tsx](src/components/PropertiesModal.tsx)
  - 旧版/简化版属性弹窗（基于 [src/constants.ts](src/constants.ts) 的 `AnalysisConfig`），目前主要用于展示并编辑 `year`。

---

## services

- [src/services/basicParamsService.ts](src/services/basicParamsService.ts)
  - 基础参数模板的“默认保证逻辑”（确保后端有默认模板，并缓存当前 numeric `id`）。
  - 供断面创建流程在缺省情况下获取可用的 `basic_param_id`。

---

## types

- [src/types/sections.ts](src/types/sections.ts)
  - `SectionParams`：断面（或组）参数的前端表示。
- [src/types/selection.ts](src/types/selection.ts)
  - `SelectionGroup`：自定义组结构（包含母线、起止点、间距、长度、以及可选 properties）。

---

## utils

- [src/utils/geometry.ts](src/utils/geometry.ts)
  - 几何工具：`generatePerpendicularLines()` 负责沿母线按间距生成断面线。
- [src/utils.ts](src/utils.ts)
  - 目前仅保留 `sendCrossLinesToBackend()`（旧流程）以及从 [src/utils/geometry.ts](src/utils/geometry.ts) re-export 的 `generatePerpendicularLines`。
  - 备注：该文件当前在主流程中未被引用，更多是 legacy/备用。

---

## 常量

- [src/constants.ts](src/constants.ts)
  - `ANALYSIS_CONFIG_DEFAULT` 与 `AnalysisConfig` 类型（旧版风险分析配置结构）。

---

## public

- [public/bank.geojson](public/bank.geojson)
  - 示例/测试数据。

---

## legacy / 备用文件（建议仅作参考）

这些文件包含历史实现（重复的 `generatePerpendicularLines` / `SelectionGroup` / `sendCrossLinesToBackend` 等），容易造成“同一系统多处实现”的错觉：

- [src/App_old.tsx](src/App_old.tsx)
  - 旧版 App/编辑逻辑聚合文件（体量大，含重复实现）。
- [src/pages/EditorPage copy.tsx](src/pages/EditorPage%20copy.tsx)
  - 旧版 EditorPage 备份文件（体量大，含重复实现）。

---

## 后续整理建议（非必须，但能持续保持结构清爽）

- 若要进一步降低 `EditorPage` 体积：可将“侧边栏 UI 触发的模式切换”整理成 `useEditorModes()` hook。
- 若要减少 lint 噪音：将 `EditorSidebar.tsx` 中零散的 inline style 迁移到 [src/components/EditorSidebar.module.css](src/components/EditorSidebar.module.css)（仓库内已有规则提示不鼓励 inline style）。
