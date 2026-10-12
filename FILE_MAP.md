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

---

## public

- [public/bank.geojson](public/bank.geojson)
  - 示例/测试数据（源码里无引用，但可能被"手动上传 GeoJSON"的验证流程用到，保留）。
- ~~`public/fonts/黄令东齐伋复刻.ttf`~~ —— **已于 2026-10-12 删除**。
  39.5 MB、全仓库零引用（无 `@font-face` / `url()` / JS 引用），却每次 `vite build`
  都被拷进 `dist/fonts/`；删除后 `dist/` 总体积 47.5 MB → 8.0 MB。
  若将来要用，`git checkout d7f67e6~1 -- public/fonts/` 可取回。

---

## legacy / 备用文件（已确认不可达，暂按"参考件"保留）

这些文件**从入口 `main.tsx` 出发不可达**（静态引用 + 测试引用 + 构建配置三重核对），
且被 `tsconfig.app.json` 的 `exclude` 或注释掉的 `<Route>` 排除在生效范围外：

- [src/App_old.tsx](src/App_old.tsx)
  - 旧版 App/编辑逻辑聚合文件（1545 行）。`tsconfig.app.json` 显式 exclude。
- [src/pages/EditorPage%20copy.tsx](src/pages/EditorPage%20copy.tsx)
  - 旧版 EditorPage 备份文件（1783 行）。`tsconfig.app.json` 显式 exclude。
- [src/pages/SmartWorkbenchPage.tsx](src/pages/SmartWorkbenchPage.tsx)
  - 智能工作台（2765 行）。`App.tsx` 里 `import` 与两条 `<Route>` 都被注释掉（"暂时隐藏"）。
  - 它是 `tsc -b` 报错的主要来源之一（约 40 条"已声明但未读取"）—— 清理它内部未使用变量前，
    建议先确认这个页面是"废弃"还是"待恢复"，两种结论对应完全不同的处理方式。

> 这三个文件当前**不影响构建产物**（vite 不打包不可达模块），也不影响运行；留着只是让 `tsc -b` / `eslint` 噪音偏大。

---

## 已删除（2026-10-12 前端冗余清理）

删除前对每个文件做了三重取证：**① 从 `main.tsx` 出发的模块可达性遍历；② 测试文件引用；③ vite/tsconfig 引用。**
三条全部为空才删。

| 删除对象 | 体积 | 依据 |
|---|---|---|
| `src/pages/EditorPageCopy.tsx` | 0 B | 空文件，无任何引用 |
| `src/components/tree/TreeToolbar.tsx` | 35 行 | 构建资源树的计划组件；实际 `ResourceSidebar.tsx` 自己渲染 header/footer，从未 import 它 |
| `src/components/PropertiesModal.tsx` | 139 行 | 被 `SectionPropertiesModal` 取代，无引用；本文件原已标注为"旧版/简化版" |
| `src/constants.ts` | 34 行 | 唯一引用者是被删的 `PropertiesModal` 与 `utils.ts` |
| `src/utils.ts` | 54 行 | legacy shim，只 re-export `geometry.ts`（真实调用方都直接 import `utils/geometry`） |
| `public/vite.svg` | 1.5 KB | Vite 脚手架默认图标，`index.html` 用的是 `/logo.png` |

同时清掉的"连带死代码"：只被 `TreeToolbar` 使用的 4 组 CSS 规则、早已无人使用的 `.legend` /
`--tree-amber` / `.muted`、`EditorSidebar.module.css` 里 8 组自定义组 UI 的残留样式、
`App.css` 里 58 条"选择器含已确认从不出现的 class"的规则（含整块进度弹窗、顶栏旧 tab 组）、
`AdminUserPage.css` 里 3 条骨架屏残留，以及一批未使用的 import / 局部变量 / catch 绑定。

合计：**18 个文件、-907 行**，CSS 产物 `113.70 kB → 104.20 kB`。

---

## 后续整理建议（非必须，但能持续保持结构清爽）

- `tsc -b` 目前**不是干净通过**（清理后仍有 46 条）。其中 41 条（"已声明但未读取"）
  **全部**集中在 `SmartWorkbenchPage.tsx` —— 即那个被注释掉的"暂时隐藏"页面。
  确认它要恢复还是废弃，再决定是清理它内部还是整文件删除，这一步能一次拿掉 41 条。
- 另 5 条是**既有真实类型错误**，与本轮清理无关，但 `package.json` 的 `build` 脚本是
  `tsc -b && vite build`，所以 `npm run build` 会因为它们失败（`npm run dev` 不受影响）：
  `WorkspacePanel.tsx` 的 `filename`/`activeTab.filename` 可能为 `undefined`；
  `ResultPage.tsx` 的 Modal `styles.content` 不是合法键；`utils/apiClient.ts` 的 fetch 包装类型不兼容。
- `EditorSidebar` 那 12 个自定义组 prop 现已只从解构里摘掉（接口与传参保持原样）。
  若确认"自定义断面组"功能不再恢复，可连同 `EditorPage` 里对应的 6 个 handler 与
  `pages/editor/customSegments.ts` 整条链一起删除 —— 这是"删功能"而非"删冗余"，需单独拍板。
- 若要进一步降低 `EditorPage` 体积：可将"侧边栏 UI 触发的模式切换"整理成 `useEditorModes()` hook。
- 若要减少 lint 噪音：将 `EditorSidebar.tsx` 中零散的 inline style 迁移到
  [src/components/EditorSidebar.module.css](src/components/EditorSidebar.module.css)
  （仓库内已有规则提示不鼓励 inline style）。
