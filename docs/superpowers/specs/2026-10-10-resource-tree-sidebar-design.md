# 设计文档：岸段/断面/参数/DEM 树形资源管理器重构

- 日期：2026-10-10
- 范围：`bank-warning-web`（前端）
- 状态：设计已确认，待实现计划

## 1. 背景与目标

当前编辑器（`EditorPage`）左侧栏 `EditorSidebar` 是 7 个平铺区块（创建岸段 / 生成断面 / 参数配置 / 截取岸段 / 断面精细调整 / 视图与工具 / 底部执行分析），岸段列表、断面、参数模板、DEM、任务等数据以散落按钮与扁平列表呈现，数据组织不清晰：看不出「一次计算用了哪些岸段、断面、参数、DEM、任务名」。

**目标**：将左侧栏重构为高度仿真的 IDE 项目资源管理器（树形目录），把岸段 / 断面 / 参数模板 / DEM 提升为平行的首类数据，并把「计算任务」设计为代表一次计算上下文的引用集合，使数据组织清晰、可复用、可追溯。

## 2. 非目标（Non-goals）

- **不改动**后端 `bank-warning-server`、模型 `bank-model-server`、数据库表结构与处理逻辑。
- **不改动**地图交互、色彩矩阵渲染（`computeColorWithMatrix`）、结果页结果渲染逻辑。
- 不重写数据获取层：复用现有 REST 接口与 `apiClient`（Bearer 注入）。
- 首期不重构结果页（`ResultPage`）侧栏（列为第二阶段候选）。
- 不做拖拽排序 / 拖拽入任务等高级交互（列为后续可选）。

## 3. 决策记录

| 编号 | 决策 | 结论 |
|---|---|---|
| D1 | 树的组织维度 | **资源池 + 任务引用**：顶层两组「数据资源」与「计算任务」；数据资源下岸段/断面/参数模板/DEM **并列平铺**；任务节点下皆为**对真实数据的引用，非复制** |
| D2 | 操作入口 | **混合式**：顶部工具栏（全局操作）+ 节点 hover 浮现 2~3 个高频图标 + 右键菜单承载该类型全量操作 |
| D3 | 计算流程 | **任务优先**：先 `＋新建任务`（命名）→ 选中任务设参数模板/DEM 引用 → 任务内生成断面 → 执行分析 |
| D4 | 应用范围 | 仅编辑器页（`EditorPage` 左侧栏）；结果页任务列表列第二阶段 |
| D5 | 深色范围 | **仅侧边栏深色**（IDE 面板），地图与顶部导航保持现状浅色 |
| D6 | 任务下断面展示 | **按岸段分组 + 虚拟滚动**；任务节点显示摘要（数量/参数/DEM），展开列出断面 |
| D7 | 后端契约 | 沿用现有 REST：`POST /tasks` → `POST /sections`(带 task_id) → `POST /tasks/{id}/run`；DEM 仍由参数模板内 `bench_id`/`ref_id` 承载，树上只做只读解析展示 |

## 4. 架构总览

```
EditorPage
└─ .editor-sidebar-panel (保留可拖宽, 默认350px)
   └─ <ResourceSidebar>                 ← 新容器（替换 EditorSidebar 内容）
      ├─ <TreeToolbar>                  ← 顶部全局操作
      ├─ <ResourceTree>                 ← 递归树 + 虚拟滚动
      │   └─ <ResourceTreeNode> × N     ← 行：图标/名称/元信息/hover图标/右键
      │       └─ <TreeContextMenu>      ← 按 kind 渲染操作项
      └─ <ExecuteBar>                   ← 底部：▶ 执行风险分析 + 当前任务
```

数据适配：`treeModel.ts` 将 REST 响应映射为统一 `TreeNode[]`。
状态：新增 `useResourceTreeStore`（zustand）管理展开态、选中态、加载态、当前任务。

## 5. 树节点模型（递归 JSON）

```ts
export type NodeKind =
  | 'root'          // 工作区根
  | 'group'         // 分组（数据资源 / 计算任务 / 某个任务）
  | 'folder'        // 子分组（岸段 / 断面 / 参数模板 / DEM；DEM 的 segment/year）
  | 'bank'          // 岸段实体
  | 'section'       // 断面实体
  | 'param'         // 参数模板实体
  | 'dem'           // DEM(tiff) 实体
  | 'task'          // 计算任务实体
  | 'task-ref';     // 任务内的引用项（引用断面集合/参数/DEM，非复制）

export interface TreeRef {
  entity: 'bank' | 'section' | 'param' | 'dem' | 'task';
  key: string;      // bank_id / section_id / param_id / tiff_key / task_id
}

export interface TreeNode {
  id: string;                 // 稳定 id，如 "bank:bankwgs84_30"
  kind: NodeKind;
  label: string;              // 显示名
  icon?: string;              // 图标键（映射到 lucide 组件）
  meta?: string;              // 计数 / 点数 / 时间点等次要信息
  ref?: TreeRef;              // 指向真实实体
  children?: TreeNode[];      // 递归子节点
  selectable: boolean;        // 是否可选中（folder/group 视需要）
  actions?: ActionKey[];      // 可用操作（驱动 hover 图标与右键菜单）
}
```

**引用原则**（D1）：`task-ref` 节点携带 `ref` 指向真实实体；树不持有数据副本，编辑资源即全局生效，历史任务的引用始终可解析。

## 6. 树结构与数据映射

| 树节点 | 来源接口 | 映射规则 |
|---|---|---|
| 数据资源 › 岸段（`kind:bank`） | `GET /v0/bank/banks` | 每条 bank → 节点，`id=bank:<bank_id>`，meta 可含点数 |
| 数据资源 › 断面（`kind:section`） | `GET /v0/bank/sections?task_id=<id>`（按任务分组拉取） | 先按 task 分组为 `folder`，其下 section 节点（D6 虚拟滚动） |
| 数据资源 › 参数模板（`kind:param`） | `GET /v0/bank/basic-params` | 每个模板 → 节点，`id=param:<param_id>`，默认项加标记 |
| 数据资源 › DEM（`kind:dem`） | `GET /v0/bank/tiffs` | 按 `segment → year → tiff_key` 三层分组 |
| 计算任务 › 任务（`kind:task`） | `GET /v0/bank/tasks` | 每个任务 → 节点，`id=task:<task_id>` |
| 任务内引用（`kind:task-ref`） | 由任务数据 + 参数模板解析 | 断面集合（引用，计数+按岸段分组）、参数模板（引用 param_id）、DEM（经参数模板 `bench_id`/`ref_id` 解析出的 tiff_key） |

数据加载策略：树懒加载——顶层与一级分组常驻；展开「断面（按任务）」时按 `task_id` 拉取；展开任务引用时解析参数模板。

## 7. 操作清单（全系统 46 项）与入口映射

> 图例：`TB`=顶部工具栏，`HV`=节点 hover 图标，`CM`=右键菜单。

### 7.1 岸段（14）
| 操作 | 入口 | 现有实现参考 |
|---|---|---|
| 上传岸段(GeoJSON) | TB + 岸段文件夹 CM | `handleFileUpload` |
| 多选（Ctrl/Shift 范围） | 树节点 | `bankSelect` 逻辑 |
| 删除（单条/多条/按 region_code 组） | CM | `deleteBankById` / `deleteBanksByIds` / `deleteBankGroup` |
| 平滑岸段 | CM | `smoothSelectedShoreLines` |
| 按 TIF 选岸段 | CM | `onSelectBanksByTiff` |
| 加载到地图 / 移出地图 | HV + CM | `loadBankById` / `removeBankFromMap` |
| 查看属性 / 参数配置 | CM | `onBankParamsView` |
| 清除已加载岸段 | CM | `deleteLoadedBanks` |
| 截取岸段（拾取起终点） | CM | `toggleStartEndSelection` / `onClipBank` |
| 删除截取岸段 | CM | `deleteBankById` |
| 岸段着色开关 | TB/批 CM | `colorBanks` |
| 修正选择(反向) | CM | `toggleFixShoreLineReversed` |
| 上传选中岸段 GeoJSON | CM | `sendSelectedShoreLinesGeoJson` |
| 生成断面时选段 | 生成对话框内 | `toggleShoreLineSelection` / `toggleSelectAllShoreLines` |

### 7.2 断面（16）
| 操作 | 入口 |
|---|---|
| 上传断面 JSON | TB + 断面文件夹 CM |
| 选中岸段 / 全选（生成用） | 生成对话框内 |
| 生成展示断面 | 断面文件夹 CM / 任务 CM |
| 生成计算断面 | 任务节点 HV/CM（D3） |
| 断面检查（校验） | 断面文件夹 CM |
| 一键删除无效断面 | 断面文件夹 CM |
| 导出断面样例 | 断面文件夹 CM |
| 反切（单个 / 组内） | section 节点 CM / 组 CM |
| 精调：沿线约束 / 自由拖动 | 断面文件夹 CM（进入精调模式） |
| 新建断面：按垂线 / 自由创建 | 断面文件夹 CM |
| 平移(±1/±5m) / 旋转(±5°) / 缩放(±10m) | 选中断面后操作栏 |
| 断面属性 | section 节点 CM |
| 断面批量参数 | 断面文件夹 CM |
| 删除断面（单/组） | section 节点 CM |
| 断面间距 / 长度设置 | 生成对话框 |
| 显示 / 隐藏设计（断面显隐） | TB |

### 7.3 参数模板（4）
| 操作 | 入口 |
|---|---|
| 选择参数模板（设为当前/任务引用） | param 节点 CM / 任务 CM |
| 模板属性配置（全局属性） | param 节点 CM（`PropertiesModal`） |
| 编辑断面参数 | section 属性（`SectionPropertiesModal`） |
| 确保默认参数模板 | 自动（`ensureDefaultBasicParams`） |

### 7.4 DEM（4）
| 操作 | 入口 |
|---|---|
| 选择 DEM | 任务 CM / 参数模板编辑（`TiffResourcePicker`） |
| 上传自定义 DEM | DEM 文件夹 CM（`TiffResourcePicker` 内） |
| 删除 DEM | dem 节点 CM |
| 显示 / 隐藏 TIF 范围 | TB |

### 7.5 任务（4）
| 操作 | 入口 |
|---|---|
| 创建任务（命名） | TB `＋新建任务`（`TaskNameModal`） |
| 执行风险分析 | 任务节点 HV `▶` + ExecuteBar |
| 查看结果 | 任务节点 CM → `/result/{taskId}` |
| 删除任务 | 任务节点 CM |

### 7.6 全局（4）
| 操作 | 入口 |
|---|---|
| 清空 | TB |
| 卫星图开关 | TB |
| 导出报告 | 结果页（`ResultPage`，本设计不改） |
| AI 助手 / 知识库 | 独立导航（不改） |

## 8. 计算流程（任务优先，D3）

```
1. TB「＋新建任务」→ TaskNameModal 命名 → POST /v0/bank/tasks {task_name, description}
   → 得 task_id，树上「计算任务」下出现任务节点（选中它）
2. 选中任务节点 → 设置/查看：参数模板（引用 param_id）、DEM（由模板 bench_id/ref_id 解析）
3. 任务 CM「生成计算断面」→ 对话框选岸段 + 间距 + 长度 + 属性
   → 逐条 POST /v0/bank/sections（携带 task_id）
   → 断面集合挂到该任务节点（引用）
4. ExecuteBar / 任务 HV「▶」→ POST /v0/bank/tasks/{taskId}/run
5. 完成后 CM「查看结果」→ /result/{taskId}
```

组织关系（回答需求 #4）：
`task = { task_id, task_name, 引用 param_id, 断面(按 task_id), DEM(经参数模板解析的 tiff_key) }` —— **全部为引用**。

兼容性：后端契约不变。前端流程由「先生成断面、后弹窗命名」重排为「先建任务、再在任务内生成断面」，仅需把生成逻辑的上下文来源从全局 store 切换为「当前选中任务」。

## 9. 状态管理

新增 `useResourceTreeStore`（zustand，`src/store/useResourceTreeStore.ts`）：
```ts
interface ResourceTreeState {
  expanded: Record<string, boolean>;      // 节点展开态
  selectedId: string | null;              // 当前选中节点
  currentTaskId: string | null;           // 当前任务（生成/执行上下文）
  loadingIds: Record<string, boolean>;    // 懒加载中
  // 数据缓存
  banks: any[]; sectionsByTask: Record<string, any[]>;
  params: any[]; tiffs: any[]; tasks: any[];
  // actions
  toggleExpanded(id): void;
  selectNode(id): void;
  setCurrentTask(id): void;
  refresh...(): Promise<void>;
}
```
与现有 `useEditorStore` 协作：地图相关（`showCrossLines`、`colorBanks`、`satellite`、`selectedLines` 等）仍由 `useEditorStore` 持有；树仅驱动选择/上下文，不重复存储地图状态。

## 10. 样式规范（VS Code 深色）

| Token | 值 |
|---|---|
| 树背景 | `#1e1e1e` |
| 面板/工具栏 | `#252526` |
| 节点 hover | `#2a2d2e` |
| 选中高亮 | `#04395e`（文字 `#ffffff`） |
| 主文字 | `#cccccc` |
| 次要文字 | `#7a7a7a` |
| 岸段/断面/参数/DEM/任务图标色 | `#dcdcaa` / `#ce9178` / `#c586c0` / `#4ec9b0` / `#9cdcfe` |
| 缩进 | 20px/级 |
| 字体 | 树用等宽（`Consolas, "Courier New"`），中文回退 `"Microsoft YaHei"` |

深色仅作用于侧栏容器（D5）；地图与顶栏保持浅色。实现方式：CSS Module + 局部 CSS 变量，避免污染全局。

## 11. 交互规范

- 展开/折叠：点击 chevron 或双击节点；支持无限层级。
- 单击节点：选中（`#04395e`）；同时地图高亮对应岸段/断面范围。
- 双击节点：定位缩放（岸段/DEM）。
- 右键节点：弹出该 `kind` 的全量操作菜单。
- hover：显示 2~3 个高频图标 + `⋯`（更多=右键菜单）。
- 键盘：↑/↓ 移动选中，←/→ 折叠/展开，Enter 触发主操作，Esc 关闭菜单。
- 顶部工具栏：上传岸段 / 上传断面 / ＋新建任务 / 清空。
- 底部 ExecuteBar：`▶ 执行风险分析` + 当前任务名。

## 12. 性能与虚拟滚动

- 断面列表可达数百条（示例任务 410 条）：任务/断面分组节点下采用虚拟滚动（窗口化渲染），仅渲染可视区域。
- 数据懒加载：仅在展开时拉取；缓存于 store，`refresh` 手动刷新。
- 展开态、选中态持久化（可选，`localStorage`）。

## 13. 边界情况与错误处理

- 接口失败：节点显示错误态与重试入口（沿用 `ConfirmModal`/message 提示，替换原生 `alert`）。
- 空状态：各分组显示占位（如「暂无任务」）。
- 数据不一致：任务引用的 param/section 已删除时，引用项显示为失效态（灰色 + 提示），不崩溃。
- 大列表：虚拟滚动兜底。

## 14. 兼容性与不改动范围

- 保留 `.editor-layout` / `.editor-sidebar-panel`（可拖宽）与 `leftPanelWidth`。
- 保留 `useEditorStore` 字段与地图相关逻辑；`clearEditorData` 语义不变。
- 现有组件复用：`TaskNameModal`、`TiffResourcePicker`、`SectionPropertiesModal`、`PropertiesModal`、`ConfirmModal`。
- 后端接口、DB、模型服务不动。

## 15. 分阶段实施（建议）

1. **P0 骨架**：`ResourceTree` + `ResourceTreeNode` + 递归渲染 + 深色样式 + 展开折叠/选中/hover。
2. **P1 数据接入**：`treeModel.ts` + `useResourceTreeStore`，接入 banks/params/tiffs/tasks/sections 只读展示。
3. **P2 操作接线**：`TreeToolbar` + hover 图标 + `TreeContextMenu`，逐类接线 47 项操作（复用现有 handler）。
4. **P3 任务流程**：任务优先流程（新建任务 → 任务内生成断面 → 执行）。
5. **P4 打磨**：虚拟滚动、键盘导航、地图联动、失效引用态、空态。

## 16. 验证方式

- 构建：`npx vite build`（勿用 `npm run build`）；`tsc` 以 75 个预存错误为基线，零新增。
- 手工回归（浏览器）：上传岸段 → 生成断面 → 新建任务 → 任务内生成计算断面 → 执行 → 结果页；岸段色带、断面颜色正常。
- 覆盖清单：46 项操作逐一验证入口可达、行为与原实现一致。

## 17. 风险

- `EditorPage.tsx` 体量巨大（2400+ 行），拆分数据适配与操作接线时需谨慎，避免回归。
- 生成逻辑从全局状态迁移到「任务上下文」，需回归全部生成路径（展示/计算/精调）。
- 深色侧栏与浅色页面的视觉衔接需打磨。
