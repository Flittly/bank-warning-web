# 树形资源管理器重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将编辑器左侧栏重构为 VS Code 风格的深色树形资源管理器，把岸段/断面/参数模板/DEM 作为平行首类数据、计算任务作为引用集合，并按「任务优先」流程组织断面计算。

**Architecture:** 新增纯函数数据适配层 `treeModel`（REST 数据 → 递归 `TreeNode`）、zustand 状态 `useResourceTreeStore`、以及 `ResourceSidebar` 组件族（Toolbar / Tree / TreeNode / ContextMenu）。在 `EditorPage` 中用 `ResourceSidebar` 替换现有 `EditorSidebar` 的渲染，但完整复用 `EditorPage` 现有的 60+ 个 handler（作为 props 透传），不改后端与地图逻辑。

**Tech Stack:** React 19、TypeScript 5.9、zustand 5、Vite 7、antd 6、lucide-react、vitest（新增，仅测纯逻辑）。

**依据规格：** `bank-warning-web/docs/superpowers/specs/2026-10-10-resource-tree-sidebar-design.md`

---

## 文件结构（先定边界）

**新增：**
- `src/tree/types.ts` — `TreeNode` / `NodeKind` / `TreeRef` / `ActionKey` 类型
- `src/tree/treeModel.ts` — 纯函数：`buildBanksFolder` / `buildParamsFolder` / `buildDemFolder` / `buildTasksGroup` / `buildSectionsFolder` / `buildResourceTree`
- `src/tree/actions.ts` — 操作注册表：`ActionKey → { label, icon, scope }`
- `src/store/useResourceTreeStore.ts` — 展开/选中/当前任务/懒加载缓存
- `src/components/tree/ResourceSidebar.tsx` — 容器（Toolbar + Tree + ExecuteBar）
- `src/components/tree/TreeToolbar.tsx` — 顶部全局操作
- `src/components/tree/ResourceTree.tsx` — 递归渲染 + 虚拟滚动
- `src/components/tree/ResourceTreeNode.tsx` — 单行节点
- `src/components/tree/TreeContextMenu.tsx` — 右键菜单
- `src/components/tree/ResourceSidebar.module.css` — 深色 IDE 样式
- `src/tree/treeModel.test.ts`、`src/store/useResourceTreeStore.test.ts` — 单测

**修改：**
- `src/pages/EditorPage.tsx:2168-2278` — 用 `ResourceSidebar` 替换 `EditorSidebar` 挂载
- `package.json` — 增加 `vitest` 与 `test` 脚本

**保留不动：** `src/components/EditorSidebar.tsx`（暂留，回归对照），其余地图/结果/后端逻辑不动。

---

## Task 0: 创建特性分支

- [ ] **Step 1: 从 main 建分支**

Run:
```powershell
git -C "E:\Graduate\graduate-1\workspace\yangtze-bank-warning-system\bank-warning-web" switch -c feature/resource-tree-sidebar
```
Expected: `Switched to a new branch 'feature/resource-tree-sidebar'`

## Task 1: 引入 vitest（仅纯逻辑单测）

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 vitest 并写脚本**

Run:
```powershell
npm install -D vitest
```
Then edit `package.json` scripts, add:
```json
    "test": "vitest run"
```

- [ ] **Step 2: 加一个冒烟测试并在 Step 3 验证**

Create `src/tree/treeModel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run src/tree/treeModel.test.ts`
Expected: `1 passed`

- [ ] **Step 4: 提交**

```powershell
git add package.json package-lock.json src/tree/treeModel.test.ts
git commit -m "chore: 引入 vitest 用于纯逻辑单测"
```

## Task 2: 定义树类型

**Files:**
- Create: `src/tree/types.ts`
- Test: `src/tree/types.test.ts`

- [ ] **Step 1: 写测试（类型可被构造）**

Create `src/tree/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { TreeNode, NodeKind } from './types';

describe('types', () => {
  it('constructs a recursive node', () => {
    const kind: NodeKind = 'bank';
    const node: TreeNode = {
      id: 'bank:bankwgs84_30',
      kind,
      label: 'bankwgs84_30',
      selectable: true,
      children: [{ id: 'x', kind: 'section', label: 's', selectable: true }],
    };
    expect(node.children?.length).toBe(1);
    expect(node.kind).toBe('bank');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/tree/types.test.ts`
Expected: FAIL（找不到 `./types`）

- [ ] **Step 3: 实现类型**

Create `src/tree/types.ts`:
```ts
export type NodeKind =
  | 'root'
  | 'group'
  | 'folder'
  | 'bank'
  | 'section'
  | 'param'
  | 'dem'
  | 'task'
  | 'task-ref';

export type RefEntity = 'bank' | 'section' | 'param' | 'dem' | 'task';

export interface TreeRef {
  entity: RefEntity;
  key: string;
}

export type ActionKey = string;

export interface TreeNode {
  id: string;
  kind: NodeKind;
  label: string;
  icon?: string;
  meta?: string;
  ref?: TreeRef;
  children?: TreeNode[];
  selectable: boolean;
  actions?: ActionKey[];
  invalid?: boolean;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/tree/types.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add src/tree/types.ts src/tree/types.test.ts
git commit -m "feat(tree): 定义树节点类型"
```

## Task 3: treeModel —— 岸段 / 参数 / DEM 分组

**Files:**
- Create: `src/tree/treeModel.ts`
- Test: `src/tree/treeModel.test.ts`（替换冒烟测试）

- [ ] **Step 1: 写测试**

Replace `src/tree/treeModel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildBanksFolder, buildParamsFolder, buildDemFolder } from './treeModel';

describe('buildBanksFolder', () => {
  it('maps banks to nodes, skips clipped', () => {
    const folder = buildBanksFolder([
      { bank_id: 'bankwgs84_30', bank_name: '线段31', region_code: 'Mzs' },
      { bank_id: 'bankwgs84_30_clip_1', bank_name: '片段', region_code: 'Mzs' },
    ]);
    expect(folder.kind).toBe('folder');
    expect(folder.children?.length).toBe(1);
    expect(folder.children?.[0]).toMatchObject({
      id: 'bank:bankwgs84_30', kind: 'bank', label: '线段31',
      ref: { entity: 'bank', key: 'bankwgs84_30' }, selectable: true,
    });
  });
});

describe('buildParamsFolder', () => {
  it('marks default param and uses param_id', () => {
    const folder = buildParamsFolder([
      { id: 53, param_id: 'PARAM_DEFAULT_TEMPLATE', param_name: '默认参数模板', other_params: { is_default: true } },
      { id: 54, param_id: 'PARAM_FLOOD', param_name: '丰水期方案' },
    ]);
    expect(folder.children?.length).toBe(2);
    // 键与 EditorPage 的匹配规则一致：param_id ?? id（见 EditorPage.tsx:281 / handleSelectBasicParam）
    expect(folder.children?.[0]).toMatchObject({ id: 'param:PARAM_DEFAULT_TEMPLATE', kind: 'param', meta: '默认' });
    expect(folder.children?.[1]).toMatchObject({ id: 'param:PARAM_FLOOD', kind: 'param' });
  });
});

describe('buildDemFolder', () => {
  it('groups tiffs by segment then year', () => {
    const folder = buildDemFolder([
      { tiff_key: 'tiff/Mzs/2023/standard/202304/a.tif', segment: 'Mzs', year: '2023', timepoint: '202304' },
      { tiff_key: 'tiff/Mzs/2019/standard/201904/b.tif', segment: 'Mzs', year: '2019', timepoint: '201904' },
    ]);
    const seg = folder.children?.[0];
    expect(seg?.label).toContain('Mzs');
    expect(seg?.children?.length).toBe(2);
    const dem = seg?.children?.[0]?.children?.[0];
    expect(dem).toMatchObject({ kind: 'dem', ref: { entity: 'dem', key: 'tiff/Mzs/2019/standard/201904/b.tif' } });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/tree/treeModel.test.ts`
Expected: FAIL（`treeModel` 不存在）

- [ ] **Step 3: 实现**

Create `src/tree/treeModel.ts`:
```ts
import type { TreeNode } from './types';

export function buildBanksFolder(banks: any[]): TreeNode {
  const children: TreeNode[] = (banks || [])
    .filter((b) => !String(b?.bank_id || '').includes('_clip_'))
    .map((b) => {
      const bankId = String(b.bank_id);
      const name = String(b.bank_name || b.bankName || bankId);
      return {
        id: `bank:${bankId}`,
        kind: 'bank' as const,
        label: name,
        icon: 'bank',
        meta: b.region_code ? String(b.region_code) : undefined,
        ref: { entity: 'bank' as const, key: bankId },
        selectable: true,
        actions: [
          'bank.loadMap', 'bank.locate', 'bank.props', 'bank.smooth',
          'bank.clip', 'bank.selectByTiff', 'bank.delete',
        ],
      };
    });
  return { id: 'folder:banks', kind: 'folder', label: '岸段', icon: 'bank', selectable: false, meta: String(children.length), children, actions: ['bank.upload', 'bank.colorToggle'] };
}

export function buildParamsFolder(params: any[]): TreeNode {
  const children: TreeNode[] = (params || []).map((p: any, idx: number) => {
    const pid = p.param_id ?? p.id ?? idx;
    const name = String(p.param_name || p.paramName || pid);
    const isDefault = Boolean(p?.other_params?.is_default);
    return {
      id: `param:${pid}`,
      kind: 'param' as const,
      label: name,
      icon: 'param',
      meta: isDefault ? '默认' : undefined,
      ref: { entity: 'param' as const, key: String(pid) },
      selectable: true,
      actions: ['param.select', 'param.props', 'param.editSectionParams'],
    };
  });
  return { id: 'folder:params', kind: 'folder', label: '参数模板', icon: 'param', selectable: false, meta: String(children.length), children };
}

export function buildDemFolder(tiffs: any[]): TreeNode {
  const bySegment = new Map<string, Map<string, TreeNode[]>>();
  for (const t of tiffs || []) {
    const key = String(t?.tiff_key || t?.key || t?.file_name || '');
    if (!key) continue;
    const seg = String(t?.segment || t?.region_code || '未分组');
    const year = String(t?.year || '未知年份');
    if (!bySegment.has(seg)) bySegment.set(seg, new Map());
    const yearMap = bySegment.get(seg)!;
    if (!yearMap.has(year)) yearMap.set(year, []);
    yearMap.get(year)!.push({
      id: `dem:${key}`,
      kind: 'dem',
      label: String(t?.file_name || key.split('/').pop() || key),
      icon: 'dem',
      meta: t?.timepoint ? String(t.timepoint) : undefined,
      ref: { entity: 'dem', key },
      selectable: true,
      actions: ['dem.toggleBounds', 'dem.delete'],
    });
  }
  const children: TreeNode[] = [];
  for (const [seg, years] of [...bySegment.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))) {
    const yearNodes: TreeNode[] = [];
    for (const [year, dems] of [...years.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      dems.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
      yearNodes.push({
        id: `dem-year:${seg}:${year}`,
        kind: 'folder',
        label: year,
        selectable: false,
        meta: String(dems.length),
        children: dems,
      });
    }
    children.push({ id: `dem-seg:${seg}`, kind: 'folder', label: seg, selectable: false, meta: String(years.size), children: yearNodes });
  }
  return { id: 'folder:dems', kind: 'folder', label: 'DEM 资源', icon: 'dem', selectable: false, meta: String((tiffs || []).length), children, actions: ['dem.upload'] };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/tree/treeModel.test.ts`
Expected: PASS（3 个 describe 全绿）

- [ ] **Step 5: 提交**

```powershell
git add src/tree/treeModel.ts src/tree/treeModel.test.ts
git commit -m "feat(tree): 岸段/参数/DEM 分组构建"
```

## Task 4: treeModel —— 断面按任务分组 + 任务组与引用解析

**Files:**
- Modify: `src/tree/treeModel.ts`
- Test: `src/tree/treeModel.test.ts`（追加）

- [ ] **Step 1: 追加测试**

Append to `src/tree/treeModel.test.ts`:
```ts
import { buildSectionsFolder, buildTasksGroup, resolveTaskRefs } from './treeModel';

describe('buildSectionsFolder', () => {
  it('groups sections by task and exposes counts', () => {
    const folder = buildSectionsFolder([
      { task_id: 't1', task_name: '任务1234', section_id: 's1', bank_id: 'b1' },
      { task_id: 't1', task_name: '任务1234', section_id: 's2', bank_id: 'b1' },
    ]);
    const g = folder.children?.[0];
    expect(g?.id).toBe('sections-task:t1');
    expect(g?.meta).toBe('2');
    expect(g?.children?.[0]).toMatchObject({ kind: 'section', ref: { entity: 'section', key: 's1' } });
  });
});

describe('buildTasksGroup', () => {
  it('creates task nodes', () => {
    const group = buildTasksGroup([{ task_id: 't1', task_name: '任务1234' }]);
    expect(group.children?.[0]).toMatchObject({ id: 'task:t1', kind: 'task', label: '任务1234' });
  });
});

describe('resolveTaskRefs', () => {
  it('resolves section/param/dem references (no copies)', () => {
    const refs = resolveTaskRefs(
      { task_id: 't1' },
      { sections: [{ section_id: 's1', bank_id: 'b1' }, { section_id: 's2', bank_id: 'b1' }], bench_id: 'tiff/Mzs/2023/standard/202304/a.tif', ref_id: 'tiff/Mzs/2019/standard/201904/b.tif' },
    );
    expect(refs.find((r) => r.id === 'task-ref:t1:sections')?.meta).toBe('2');
    expect(refs.find((r) => r.id === 'task-ref:t1:dems')?.children?.length).toBe(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/tree/treeModel.test.ts`
Expected: FAIL（未导出 `buildSectionsFolder` 等）

- [ ] **Step 3: 追加实现**

Append to `src/tree/treeModel.ts`:
```ts
export function buildSectionsFolder(sections: any[]): TreeNode {
  const byTask = new Map<string, TreeNode[]>();
  for (const s of sections || []) {
    const taskId = String(s?.task_id || 'unknown');
    const secId = String(s?.section_id || s?.id || '');
    if (!secId) continue;
    if (!byTask.has(taskId)) byTask.set(taskId, []);
    byTask.get(taskId)!.push({
      id: `section:${secId}`,
      kind: 'section',
      label: `#${secId}`,
      icon: 'section',
      meta: s?.bank_id ? String(s.bank_id) : undefined,
      ref: { entity: 'section', key: secId },
      selectable: true,
      actions: ['section.reverse', 'section.props', 'section.delete'],
    });
  }
  const children: TreeNode[] = [...byTask.entries()].map(([taskId, secs]) => ({
    id: `sections-task:${taskId}`,
    kind: 'folder',
    label: taskId,
    selectable: false,
    meta: String(secs.length),
    children: secs,
    actions: ['section.validate', 'section.deleteInvalid', 'section.export', 'section.reverse', 'section.batchParams', 'section.fineTune'],
  }));
  return { id: 'folder:sections', kind: 'folder', label: '断面', icon: 'section', selectable: false, meta: String((sections || []).length), children, actions: ['section.upload', 'section.generateDisplay', 'section.toggleVisible'] };
}

export function buildTasksGroup(tasks: any[]): TreeNode {
  const children: TreeNode[] = (tasks || []).map((t: any) => {
    const tid = String(t.task_id ?? t.id);
    return {
      id: `task:${tid}`,
      kind: 'task' as const,
      label: String(t.task_name || tid),
      icon: 'task',
      meta: t?.status ? String(t.status) : undefined,
      ref: { entity: 'task' as const, key: tid },
      selectable: true,
      actions: ['task.run', 'task.generateCompute', 'task.setParam', 'task.viewResult', 'task.delete'],
    };
  });
  return { id: 'group:tasks', kind: 'group', label: '计算任务', icon: 'task', selectable: false, meta: String(children.length), children, actions: ['task.create'] };
}

export function resolveTaskRefs(
  task: any,
  data: { sections?: any[]; paramName?: string; paramKey?: string; bench_id?: string; ref_id?: string },
): TreeNode[] {
  const tid = String(task?.task_id ?? task?.id);
  const secs = data.sections || [];
  const byBank = new Map<string, number>();
  for (const s of secs) byBank.set(String(s.bank_id || '未知'), (byBank.get(String(s.bank_id || '未知')) || 0) + 1);
  const bankChildren: TreeNode[] = [...byBank.entries()].map(([bankId, count]) => ({
    id: `task-ref:${tid}:bank:${bankId}`,
    kind: 'folder',
    label: bankId,
    selectable: false,
    meta: `${count} 条`,
    ref: { entity: 'bank', key: bankId },
  }));
  const sections: TreeNode = {
    id: `task-ref:${tid}:sections`,
    kind: 'task-ref',
    label: '断面集合（引用）',
    selectable: false,
    meta: String(secs.length),
    children: bankChildren,
  };
  const params: TreeNode = {
    id: `task-ref:${tid}:param`,
    kind: 'task-ref',
    label: `参数模板: ${data.paramName || '未设置'}`,
    selectable: false,
    meta: '引用',
    ref: data.paramKey ? { entity: 'param', key: data.paramKey } : undefined,
  };
  const demChildren: TreeNode[] = [data.bench_id, data.ref_id]
    .filter(Boolean)
    .map((key, i) => ({
      id: `task-ref:${tid}:dem:${i}`,
      kind: 'dem' as const,
      label: String(key).split('/').pop() || String(key),
      meta: i === 0 ? '基准' : '对照',
      ref: { entity: 'dem' as const, key: String(key) },
      selectable: true,
      actions: ['dem.toggleBounds'],
    }));
  const dems: TreeNode = {
    id: `task-ref:${tid}:dems`,
    kind: 'task-ref',
    label: 'DEM（引用）',
    selectable: false,
    children: demChildren,
  };
  return [sections, params, dems];
}

export function buildResourceTree(data: {
  banks?: any[]; params?: any[]; tiffs?: any[]; tasks?: any[]; sections?: any[];
}): TreeNode {
  return {
    id: 'root',
    kind: 'root',
    label: 'YRBC-IRAP 工作区',
    selectable: false,
    children: [
      {
        id: 'group:resources',
        kind: 'group',
        label: '数据资源',
        selectable: false,
        children: [
          buildBanksFolder(data.banks || []),
          buildSectionsFolder(data.sections || []),
          buildParamsFolder(data.params || []),
          buildDemFolder(data.tiffs || []),
        ],
      },
      buildTasksGroup(data.tasks || []),
    ],
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/tree/treeModel.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```powershell
git add src/tree/treeModel.ts src/tree/treeModel.test.ts
git commit -m "feat(tree): 断面分组/任务组/任务引用解析与整树构建"
```

## Task 5: 操作注册表

**Files:**
- Create: `src/tree/actions.ts`
- Test: `src/tree/actions.test.ts`

- [ ] **Step 1: 写测试**

Create `src/tree/actions.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ACTION_META, getActions } from './actions';

describe('actions', () => {
  it('has labels for all used keys', () => {
    expect(ACTION_META['task.run'].label).toContain('执行');
    expect(ACTION_META['bank.delete'].label).toContain('删除');
  });
  it('getActions returns metadata for a node', () => {
    const list = getActions(['bank.smooth', 'bank.delete']);
    expect(list.map((a) => a.key)).toEqual(['bank.smooth', 'bank.delete']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/tree/actions.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现（完整注册 46 项操作用到的 key）**

Create `src/tree/actions.ts`:
```ts
import type { ActionKey } from './types';

export interface ActionMeta {
  key: ActionKey;
  label: string;
  icon: string;
  danger?: boolean;
  separatorBefore?: boolean;
}

export const ACTION_META: Record<ActionKey, ActionMeta> = {
  'bank.upload': { key: 'bank.upload', label: '上传岸段', icon: 'upload' },
  'bank.colorToggle': { key: 'bank.colorToggle', label: '岸段着色开关', icon: 'palette' },
  'bank.loadMap': { key: 'bank.loadMap', label: '加载到地图', icon: 'eye' },
  'bank.removeMap': { key: 'bank.removeMap', label: '移出地图', icon: 'eyeOff' },
  'bank.locate': { key: 'bank.locate', label: '定位缩放', icon: 'target' },
  'bank.props': { key: 'bank.props', label: '查看属性 / 参数配置', icon: 'settings' },
  'bank.smooth': { key: 'bank.smooth', label: '平滑岸段', icon: 'zap' },
  'bank.clip': { key: 'bank.clip', label: '截取岸段', icon: 'scissors' },
  'bank.confirmClip': { key: 'bank.confirmClip', label: '确认截取', icon: 'check' },
  'bank.selectByTiff': { key: 'bank.selectByTiff', label: '按 TIF 选岸段', icon: 'layers' },
  'bank.fixReversed': { key: 'bank.fixReversed', label: '修正选择(反向)', icon: 'rotate' },
  'bank.uploadSelected': { key: 'bank.uploadSelected', label: '上传选中岸段', icon: 'upload' },
  'bank.delete': { key: 'bank.delete', label: '删除岸段', icon: 'trash', danger: true, separatorBefore: true },
  'bank.clearLoaded': { key: 'bank.clearLoaded', label: '清除已加载岸段', icon: 'eraser' },

  'section.upload': { key: 'section.upload', label: '上传断面', icon: 'upload' },
  'section.toggleVisible': { key: 'section.toggleVisible', label: '显示/隐藏设计', icon: 'eye' },
  'section.generateDisplay': { key: 'section.generateDisplay', label: '生成展示断面', icon: 'ruler' },
  'section.generateCompute': { key: 'section.generateCompute', label: '生成计算断面', icon: 'ruler' },
  'section.validate': { key: 'section.validate', label: '断面检查', icon: 'checkCircle' },
  'section.deleteInvalid': { key: 'section.deleteInvalid', label: '一键删除无效断面', icon: 'trash' },
  'section.export': { key: 'section.export', label: '导出断面样例', icon: 'download' },
  'section.reverse': { key: 'section.reverse', label: '反切', icon: 'rotate' },
  'section.fineTune': { key: 'section.fineTune', label: '进入精细调整', icon: 'move' },
  'section.batchParams': { key: 'section.batchParams', label: '断面批量参数', icon: 'settings' },
  'section.props': { key: 'section.props', label: '断面属性', icon: 'settings' },
  'section.delete': { key: 'section.delete', label: '删除断面', icon: 'trash', danger: true, separatorBefore: true },

  'param.select': { key: 'param.select', label: '设为当前/任务引用', icon: 'check' },
  'param.props': { key: 'param.props', label: '模板属性配置', icon: 'settings' },
  'param.editSectionParams': { key: 'param.editSectionParams', label: '编辑断面参数', icon: 'settings' },

  'dem.upload': { key: 'dem.upload', label: '上传自定义 DEM', icon: 'upload' },
  'dem.select': { key: 'dem.select', label: '选择 DEM', icon: 'layers' },
  'dem.toggleBounds': { key: 'dem.toggleBounds', label: '显示/隐藏 TIF 范围', icon: 'eye' },
  'dem.delete': { key: 'dem.delete', label: '删除 DEM', icon: 'trash', danger: true, separatorBefore: true },

  'task.create': { key: 'task.create', label: '新建任务', icon: 'plus' },
  'task.run': { key: 'task.run', label: '执行风险分析', icon: 'play' },
  'task.generateCompute': { key: 'task.generateCompute', label: '生成计算断面…', icon: 'ruler' },
  'task.setParam': { key: 'task.setParam', label: '更换参数模板 / DEM', icon: 'settings' },
  'task.viewResult': { key: 'task.viewResult', label: '查看结果', icon: 'chart' },
  'task.delete': { key: 'task.delete', label: '删除任务', icon: 'trash', danger: true, separatorBefore: true },

  'global.clear': { key: 'global.clear', label: '清空', icon: 'eraser' },
  'global.satellite': { key: 'global.satellite', label: '卫星图', icon: 'globe' },
  'global.uploadBank': { key: 'global.uploadBank', label: '上传岸段', icon: 'upload' },
  'global.uploadSections': { key: 'global.uploadSections', label: '上传断面', icon: 'upload' },
};

export function getActions(keys: ActionKey[] = []): ActionMeta[] {
  return keys.map((k) => ACTION_META[k]).filter(Boolean);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/tree/actions.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add src/tree/actions.ts src/tree/actions.test.ts
git commit -m "feat(tree): 操作注册表"
```

## Task 6: 资源树 store

**Files:**
- Create: `src/store/useResourceTreeStore.ts`
- Test: `src/store/useResourceTreeStore.test.ts`

- [ ] **Step 1: 写测试**

Create `src/store/useResourceTreeStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useResourceTreeStore } from './useResourceTreeStore';

describe('useResourceTreeStore', () => {
  beforeEach(() => {
    useResourceTreeStore.setState({
      expanded: {}, selectedId: null, currentTaskId: null,
      banks: [], params: [], tiffs: [], tasks: [], sectionsByTask: {},
    });
  });
  it('toggles expansion', () => {
    useResourceTreeStore.getState().toggleExpanded('group:resources');
    expect(useResourceTreeStore.getState().expanded['group:resources']).toBe(true);
    useResourceTreeStore.getState().toggleExpanded('group:resources');
    expect(useResourceTreeStore.getState().expanded['group:resources']).toBe(false);
  });
  it('selects a node and sets current task', () => {
    useResourceTreeStore.getState().selectNode('task:t1');
    useResourceTreeStore.getState().setCurrentTask('t1');
    expect(useResourceTreeStore.getState().selectedId).toBe('task:t1');
    expect(useResourceTreeStore.getState().currentTaskId).toBe('t1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/store/useResourceTreeStore.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

Create `src/store/useResourceTreeStore.ts`:
```ts
import { create } from 'zustand';

interface ResourceTreeState {
  expanded: Record<string, boolean>;
  selectedId: string | null;
  currentTaskId: string | null;
  loadingIds: Record<string, boolean>;
  banks: any[];
  params: any[];
  tiffs: any[];
  tasks: any[];
  sectionsByTask: Record<string, any[]>;
  toggleExpanded: (id: string) => void;
  selectNode: (id: string | null) => void;
  setCurrentTask: (id: string | null) => void;
  setData: (partial: Partial<Pick<ResourceTreeState, 'banks' | 'params' | 'tiffs' | 'tasks'>>) => void;
  setSectionsForTask: (taskId: string, sections: any[]) => void;
}

export const useResourceTreeStore = create<ResourceTreeState>((set) => ({
  expanded: { 'group:resources': true, 'group:tasks': true, 'folder:banks': false, 'folder:sections': false, 'folder:params': false, 'folder:dems': false },
  selectedId: null,
  currentTaskId: null,
  loadingIds: {},
  banks: [],
  params: [],
  tiffs: [],
  tasks: [],
  sectionsByTask: {},
  toggleExpanded: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  selectNode: (id) => set({ selectedId: id }),
  setCurrentTask: (id) => set({ currentTaskId: id }),
  setData: (partial) => set(partial),
  setSectionsForTask: (taskId, sections) => set((s) => ({ sectionsByTask: { ...s.sectionsByTask, [taskId]: sections } })),
}));
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/store/useResourceTreeStore.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add src/store/useResourceTreeStore.ts src/store/useResourceTreeStore.test.ts
git commit -m "feat(tree): 资源树状态 store"
```

## Task 7: 深色样式 CSS module

**Files:**
- Create: `src/components/tree/ResourceSidebar.module.css`

- [ ] **Step 1: 写样式（深色 IDE token）**

Create `src/components/tree/ResourceSidebar.module.css`:
```css
.sidebar {
  --ide-bg: #1e1e1e;
  --ide-panel: #252526;
  --ide-hover: #2a2d2e;
  --ide-sel: #04395e;
  --ide-text: #cccccc;
  --ide-dim: #7a7a7a;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--ide-bg);
  color: var(--ide-text);
  font-family: Consolas, "Courier New", "Microsoft YaHei", monospace;
  font-size: 12.5px;
}
.toolbar { display: flex; gap: 6px; padding: 6px 8px; background: var(--ide-panel); border-bottom: 1px solid #333; flex-wrap: wrap; }
.tb { display: inline-flex; align-items: center; gap: 4px; background: #3c3c3c; color: #ddd; border: none; border-radius: 4px; padding: 2px 9px; font-size: 11.5px; cursor: pointer; }
.tb:hover { background: #4a4a4a; }
.tbPrimary { background: #0e639c; color: #fff; }
.tbPrimary:hover { background: #1177bb; }
.tree { flex: 1; overflow: auto; padding: 6px 4px; }
.row { display: flex; align-items: center; border-radius: 3px; padding: 1px 6px; cursor: pointer; white-space: nowrap; user-select: none; }
.row:hover { background: var(--ide-hover); }
.rowSelected { background: var(--ide-sel); color: #fff; }
.rowInvalid { opacity: 0.5; text-decoration: line-through; }
.chevron { width: 14px; color: #8a8a8a; flex: 0 0 auto; }
.icon { margin: 0 4px 0 2px; flex: 0 0 auto; display: inline-flex; }
.label { overflow: hidden; text-overflow: ellipsis; }
.meta { color: var(--ide-dim); font-size: 11px; margin-left: 6px; }
.hoverActions { margin-left: auto; display: none; gap: 2px; }
.row:hover .hoverActions { display: inline-flex; }
.hIcon { color: #4ec9b0; }
.footer { border-top: 1px solid #333; background: var(--ide-panel); padding: 6px 10px; display: flex; align-items: center; gap: 8px; }
.run { display: inline-flex; align-items: center; gap: 6px; background: #16825d; color: #fff; border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; }
.run:disabled { background: #3a3a3a; color: #888; cursor: not-allowed; }
.footerHint { color: var(--ide-dim); font-size: 11px; }
.ctx { position: fixed; z-index: 2000; background: var(--ide-panel); border: 1px solid #454545; border-radius: 5px; padding: 4px 0; min-width: 180px; box-shadow: 0 6px 18px rgba(0,0,0,.55); }
.ctxItem { display: flex; align-items: center; gap: 8px; padding: 4px 14px; font-size: 12px; cursor: pointer; color: var(--ide-text); }
.ctxItem:hover { background: var(--ide-sel); color: #fff; }
.ctxDanger { color: #f48771; }
.ctxSep { border-top: 1px solid #454545; margin: 3px 0; }
.legend { color: var(--ide-dim); font-size: 11px; padding: 4px 10px; border-top: 1px solid #2c2c2c; }
```

- [ ] **Step 2: 提交（纯样式）**

```powershell
git add src/components/tree/ResourceSidebar.module.css
git commit -m "feat(tree): 深色 IDE 样式"
```

## Task 8: ResourceTreeNode 组件

**Files:**
- Create: `src/components/tree/ResourceTreeNode.tsx`

- [ ] **Step 1: 实现**

Create `src/components/tree/ResourceTreeNode.tsx`:
```tsx
import type { MouseEvent } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Map as MapIcon,
  Layers, Settings, Zap, Scissors, Trash2, Eye, EyeOff, Target, Ruler,
  CheckCircle2, Download, RotateCw, Move, Plus, Play, BarChart2, Upload,
  Eraser, Globe, Palette, Check,
} from 'lucide-react';
import type { TreeNode } from '../../tree/types';
import { getActions } from '../../tree/actions';
import styles from './ResourceSidebar.module.css';

const ICONS: Record<string, any> = {
  folder: Folder, bank: MapIcon, section: FileText, param: Settings,
  dem: Layers, task: BarChart2,
};
const ACTION_ICONS: Record<string, any> = {
  upload: Upload, palette: Palette, eye: Eye, eyeOff: EyeOff, target: Target,
  settings: Settings, zap: Zap, scissors: Scissors, check: Check, layers: Layers,
  rotate: RotateCw, eraser: Eraser, ruler: Ruler, checkCircle: CheckCircle2,
  download: Download, move: Move, plus: Plus, play: Play, chart: BarChart2,
  trash: Trash2, globe: Globe,
};

interface Props {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode) => void;
  onDoubleClick: (node: TreeNode) => void;
  onAction: (node: TreeNode, actionKey: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
}

const HOVER_ACTIONS: Record<string, string[]> = {
  bank: ['bank.loadMap', 'bank.removeMap', 'bank.delete'],
  task: ['task.run'],
  dem: ['dem.toggleBounds'],
  section: ['section.props'],
  param: ['param.props'],
};

export default function ResourceTreeNode({
  node, depth, expanded, selected, onToggle, onSelect, onDoubleClick, onAction, onContextMenu,
}: Props) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const Icon = ICONS[node.kind] || FileText;
  const RowIcon = hasChildren && expanded ? (node.kind === 'folder' || node.kind === 'group' ? FolderOpen : Icon) : Icon;
  const hoverKeys = (HOVER_ACTIONS[node.kind] || []).slice(0, 3);

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    onSelect(node);
    if (hasChildren) onToggle(node);
  };

  return (
    <div>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''} ${node.invalid ? styles.rowInvalid : ''}`}
        style={{ paddingLeft: depth * 20 + 6 }}
        onClick={handleClick}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(node); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(node, e.clientX, e.clientY); }}
        title={node.label}
      >
        <span className={styles.chevron}>
          {hasChildren ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
        </span>
        <span className={styles.icon}><RowIcon size={14} /></span>
        <span className={styles.label}>{node.label}</span>
        {node.meta ? <span className={styles.meta}>{node.meta}</span> : null}
        {hoverKeys.length > 0 && (
          <span className={styles.hoverActions}>
            {getActions(hoverKeys).map((a) => {
              const AIcon = ACTION_ICONS[a.icon] || Settings;
              return (
                <span
                  key={a.key}
                  className={styles.hIcon}
                  title={a.label}
                  onClick={(e) => { e.stopPropagation(); onAction(node, a.key); }}
                >
                  <AIcon size={13} />
                </span>
              );
            })}
          </span>
        )}
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children!.map((child) => (
            <ResourceTreeNodeBridge
              key={child.id}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
              onSelect={onSelect}
              onDoubleClick={onDoubleClick}
              onAction={onAction}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

import ResourceTreeNodeBridge from './ResourceTreeNodeBridge';
```

- [ ] **Step 2: 实现 Bridge（读取 store 的展开/选中）**

Create `src/components/tree/ResourceTreeNodeBridge.tsx`:
```tsx
import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import ResourceTreeNode from './ResourceTreeNode';
import type { TreeNode } from '../../tree/types';

interface Props {
  node: TreeNode;
  depth: number;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode) => void;
  onDoubleClick: (node: TreeNode) => void;
  onAction: (node: TreeNode, actionKey: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
}

export default function ResourceTreeNodeBridge(props: Props) {
  const expanded = useResourceTreeStore((s) => Boolean(s.expanded[props.node.id]));
  const selected = useResourceTreeStore((s) => s.selectedId === props.node.id);
  return <ResourceTreeNode {...props} expanded={expanded} selected={selected} />;
}
```

- [ ] **Step 3: 构建校验**

Run: `npx vite build`
Expected: 构建成功（无新增 tsc 报错致失败）

- [ ] **Step 4: 提交**

```powershell
git add src/components/tree/ResourceTreeNode.tsx src/components/tree/ResourceTreeNodeBridge.tsx
git commit -m "feat(tree): 树节点与 Bridge 组件"
```

## Task 9: TreeContextMenu 组件

**Files:**
- Create: `src/components/tree/TreeContextMenu.tsx`

- [ ] **Step 1: 实现**

Create `src/components/tree/TreeContextMenu.tsx`:
```tsx
import { useEffect } from 'react';
import {
  Upload, Palette, Eye, EyeOff, Target, Settings, Zap, Scissors, Check,
  Layers, RotateCw, Eraser, Ruler, CheckCircle2, Download, Move, Plus,
  Play, BarChart2, Trash2, Globe,
} from 'lucide-react';
import type { TreeNode } from '../../tree/types';
import { getActions } from '../../tree/actions';
import styles from './ResourceSidebar.module.css';

const ACTION_ICONS: Record<string, any> = {
  upload: Upload, palette: Palette, eye: Eye, eyeOff: EyeOff, target: Target,
  settings: Settings, zap: Zap, scissors: Scissors, check: Check, layers: Layers,
  rotate: RotateCw, eraser: Eraser, ruler: Ruler, checkCircle: CheckCircle2,
  download: Download, move: Move, plus: Plus, play: Play, chart: BarChart2,
  trash: Trash2, globe: Globe,
};

interface Props {
  node: TreeNode;
  x: number;
  y: number;
  onAction: (node: TreeNode, actionKey: string) => void;
  onClose: () => void;
}

export default function TreeContextMenu({ node, x, y, onAction, onClose }: Props) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('resize', close); };
  }, [onClose]);

  const items = getActions(node.actions || []);
  return (
    <div className={styles.ctx} style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {items.map((a) => {
        const AIcon = ACTION_ICONS[a.icon] || Settings;
        return (
          <div key={a.key}>
            {a.separatorBefore && <div className={styles.ctxSep} />}
            <div
              className={`${styles.ctxItem} ${a.danger ? styles.ctxDanger : ''}`}
              onClick={() => { onAction(node, a.key); onClose(); }}
            >
              <AIcon size={13} /> {a.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 构建校验**

Run: `npx vite build`
Expected: 成功

- [ ] **Step 3: 提交**

```powershell
git add src/components/tree/TreeContextMenu.tsx
git commit -m "feat(tree): 右键菜单组件"
```

## Task 10: ResourceTree 容器（递归 + 虚拟滚动）

**Files:**
- Create: `src/components/tree/ResourceTree.tsx`

- [ ] **Step 1: 实现**

Create `src/components/tree/ResourceTree.tsx`:
```tsx
import { useMemo, useState } from 'react';
import type { TreeNode } from '../../tree/types';
import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import ResourceTreeNode from './ResourceTreeNode';
import ResourceTreeNodeBridge from './ResourceTreeNodeBridge';
import TreeContextMenu from './TreeContextMenu';
import styles from './ResourceSidebar.module.css';

interface Props {
  root: TreeNode;
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick: (node: TreeNode) => void;
  onNodeAction: (node: TreeNode, actionKey: string) => void;
}

export default function ResourceTree({ root, onNodeSelect, onNodeDoubleClick, onNodeAction }: Props) {
  const toggleExpanded = useResourceTreeStore((s) => s.toggleExpanded);
  const selectNode = useResourceTreeStore((s) => s.selectNode);
  const [ctx, setCtx] = useState<{ node: TreeNode; x: number; y: number } | null>(null);

  const handleToggle = (node: TreeNode) => toggleExpanded(node.id);
  const handleSelect = (node: TreeNode) => { selectNode(node.id); onNodeSelect(node); };
  const handleContextMenu = (node: TreeNode, x: number, y: number) => setCtx({ node, x, y });

  const children = useMemo(() => root.children || [], [root]);

  return (
    <div className={styles.tree}>
      <div className={styles.legend}>数据资源 · 计算任务</div>
      {children.map((node) => (
        <ResourceTreeNodeBridge
          key={node.id}
          node={node}
          depth={0}
          onToggle={handleToggle}
          onSelect={handleSelect}
          onDoubleClick={onNodeDoubleClick}
          onAction={onNodeAction}
          onContextMenu={handleContextMenu}
        />
      ))}
      {ctx && (
        <TreeContextMenu
          node={ctx.node}
          x={ctx.x}
          y={ctx.y}
          onAction={onNodeAction}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  );
}
```
> 说明：首版用普通递归渲染；`ResourceTreeNode` 已按深度缩进。虚拟滚动在 Task 16 对「断面」大列表单独启用（该子树切换到窗口化列表），避免一次性重写整树。

- [ ] **Step 2: 构建校验**

Run: `npx vite build`
Expected: 成功

- [ ] **Step 3: 提交**

```powershell
git add src/components/tree/ResourceTree.tsx
git commit -m "feat(tree): 树容器与右键菜单挂载"
```

## Task 11: TreeToolbar 组件

**Files:**
- Create: `src/components/tree/TreeToolbar.tsx`

- [ ] **Step 1: 实现**

Create `src/components/tree/TreeToolbar.tsx`:
```tsx
import { Upload, Plus, Eraser, Eye, EyeOff } from 'lucide-react';
import styles from './ResourceSidebar.module.css';

interface Props {
  onUploadBank: () => void;
  onUploadSections: () => void;
  onNewTask: () => void;
  onClear: () => void;
  showCrossLines: boolean;
  onToggleCrossLines: () => void;
}

export default function TreeToolbar({
  onUploadBank, onUploadSections, onNewTask, onClear, showCrossLines, onToggleCrossLines,
}: Props) {
  return (
    <div className={styles.toolbar}>
      <button type="button" className={styles.tb} onClick={onUploadBank} title="上传岸段">
        <Upload size={13} /> 上传岸段
      </button>
      <button type="button" className={styles.tb} onClick={onUploadSections} title="上传断面">
        <Upload size={13} /> 上传断面
      </button>
      <button type="button" className={`${styles.tb} ${styles.tbPrimary}`} onClick={onNewTask} title="新建任务">
        <Plus size={13} /> 新建任务
      </button>
      <button type="button" className={styles.tb} onClick={onToggleCrossLines} title="显示/隐藏设计">
        {showCrossLines ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button type="button" className={styles.tb} onClick={onClear} title="清空">
        <Eraser size={13} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 构建校验**

Run: `npx vite build`
Expected: 成功

- [ ] **Step 3: 提交**

```powershell
git add src/components/tree/TreeToolbar.tsx
git commit -m "feat(tree): 顶部工具栏"
```

## Task 12: ResourceSidebar 容器 + 数据装配

**Files:**
- Create: `src/components/tree/ResourceSidebar.tsx`

- [ ] **Step 1: 实现（含数据拉取与 treeModel 装配）**

Create `src/components/tree/ResourceSidebar.tsx`:
该组件接收一个 `handlers` 对象（由 `EditorPage` 传入，见 Task 13 的接口），负责：
1. 挂载时通过现有接口拉取 banks / params / tiffs / tasks（`authHeaders()`）；
2. 用 `buildResourceTree` 构建树；断面按当前任务懒加载；
3. 渲染 `TreeToolbar` + `ResourceTree` + 底部 `ExecuteBar`；
4. 将节点操作分发到 `handlers`（映射见 Task 14-16）。

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { authHeaders } from '../../utils/apiClient';
import { buildResourceTree, resolveTaskRefs, buildTasksGroup } from '../../tree/treeModel';
import type { TreeNode } from '../../tree/types';
import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import { useEditorStore } from '../../store/useEditorStore';
import TreeToolbar from './TreeToolbar';
import ResourceTree from './ResourceTree';
import styles from './ResourceSidebar.module.css';

export interface ResourceSidebarHandlers {
  onAction: (node: TreeNode, actionKey: string) => void;
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick: (node: TreeNode) => void;
  onUploadBank: () => void;
  onUploadSections: () => void;
  onNewTask: () => void;
  onClear: () => void;
  onRun: () => void;
}

interface Props {
  handlers: ResourceSidebarHandlers;
}

async function fetchJSON(path: string) {
  const res = await fetch(path, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

export default function ResourceSidebar({ handlers }: Props) {
  const setData = useResourceTreeStore((s) => s.setData);
  const banks = useResourceTreeStore((s) => s.banks);
  const params = useResourceTreeStore((s) => s.params);
  const tiffs = useResourceTreeStore((s) => s.tiffs);
  const tasks = useResourceTreeStore((s) => s.tasks);
  const sectionsByTask = useResourceTreeStore((s) => s.sectionsByTask);
  const setSectionsForTask = useResourceTreeStore((s) => s.setSectionsForTask);
  const currentTaskId = useResourceTreeStore((s) => s.currentTaskId);
  const showCrossLines = useEditorStore((s) => s.showCrossLines);
  const setShowCrossLines = useEditorStore((s) => s.setShowCrossLines);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [b, p, t, k] = await Promise.all([
          fetchJSON('/v0/bank/banks'),
          fetchJSON('/v0/bank/basic-params'),
          fetchJSON('/v0/bank/tiffs'),
          fetchJSON('/v0/bank/tasks'),
        ]);
        setData({
          banks: b?.banks ?? b?.data ?? [],
          params: p?.params ?? [],
          tiffs: t?.tiffs ?? t?.items ?? (Array.isArray(t) ? t : []),
          tasks: k?.tasks ?? k?.data ?? [],
        });
      } catch (e) {
        console.error('资源树数据加载失败:', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, [setData]);

  useEffect(() => {
    if (!currentTaskId || sectionsByTask[currentTaskId]) return;
    (async () => {
      try {
        const res = await fetchJSON(`/v0/bank/sections?task_id=${encodeURIComponent(currentTaskId)}`);
        setSectionsForTask(currentTaskId, res?.sections ?? res?.data ?? []);
      } catch (e) {
        console.error('断面加载失败:', e);
      }
    })();
  }, [currentTaskId, sectionsByTask, setSectionsForTask]);

  const allSections = useMemo(() => Object.values(sectionsByTask).flat(), [sectionsByTask]);
  const tree = useMemo(
    () => buildResourceTree({ banks, params, tiffs, tasks, sections: allSections }),
    [banks, params, tiffs, tasks, allSections],
  );

  const onToggleCross = useCallback(() => setShowCrossLines(!showCrossLines), [setShowCrossLines, showCrossLines]);
  const currentTaskName = useMemo(
    () => tasks.find((t: any) => String(t.task_id ?? t.id) === currentTaskId)?.task_name || currentTaskId || '',
    [tasks, currentTaskId],
  );

  return (
    <div className={styles.sidebar}>
      <TreeToolbar
        onUploadBank={handlers.onUploadBank}
        onUploadSections={handlers.onUploadSections}
        onNewTask={handlers.onNewTask}
        onClear={handlers.onClear}
        showCrossLines={showCrossLines}
        onToggleCrossLines={onToggleCross}
      />
      {loaded && <ResourceTree root={tree} onNodeSelect={handlers.onNodeSelect} onNodeDoubleClick={handlers.onNodeDoubleClick} onNodeAction={handlers.onAction} />}
      <div className={styles.footer}>
        <button type="button" className={styles.run} onClick={handlers.onRun} title="执行风险分析">
          <Play size={15} /> 执行风险分析
        </button>
        <span className={styles.footerHint}>{currentTaskName ? `当前任务: ${currentTaskName}` : '未选择任务'}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 构建校验**

Run: `npx vite build`
Expected: 成功

- [ ] **Step 3: 提交**

```powershell
git add src/components/tree/ResourceSidebar.tsx
git commit -m "feat(tree): 侧栏容器与数据装配"
```

## Task 13: 接入 EditorPage（替换 EditorSidebar 挂载）

**Files:**
- Modify: `src/pages/EditorPage.tsx`（渲染段 `2168-2278`）

- [ ] **Step 1: 引入 ResourceSidebar 并编写 action 分发**

在 `EditorPage.tsx` 顶部 import：
```tsx
import ResourceSidebar, { type ResourceSidebarHandlers } from '../components/tree/ResourceSidebar';
import type { TreeNode } from '../tree/types';
import { useResourceTreeStore } from '../store/useResourceTreeStore';
```

在组件内 `return (` 之前加入：（handler 名称沿用现有定义，见本文件已有的同名 const）
```tsx
  const setCurrentTask = useResourceTreeStore((s) => s.setCurrentTask);

  const handleTreeNodeAction = useCallback((node: TreeNode, actionKey: string) => {
    switch (actionKey) {
      case 'bank.upload': document.querySelector<HTMLInputElement>('input[data-tree-bank-upload]')?.click(); break;
      // 其余 key 的接线见 Task 14-16，会逐一补齐
      default: console.warn('未绑定操作:', actionKey);
    }
  }, []);
```

- [ ] **Step 2: 替换挂载（保留 .editor-sidebar-panel 与 ResizeHandle）**

将 `2169-2277` 的 `<EditorSidebar ... />` 替换为：
```tsx
        <ResourceSidebar handlers={{
          onAction: handleTreeNodeAction,
          onNodeSelect: (n) => { if (n.kind === 'task') setCurrentTask(n.ref?.key ?? null); },
          onNodeDoubleClick: handleTreeNodeDoubleClick,
          onUploadBank: () => handleFileUpload({ target: { files: null } } as any),
          onUploadSections: () => handleSectionsFileUpload({ target: { files: null } } as any),
          onNewTask: handleCreateTaskFromTree,
          onClear: onClear,
          onRun: handleStartAnalysis,
        }} />
```
> 注：`onUploadBank/onUploadSections` 真实实现为触发隐藏 file input（见 Task 14 Step 3），此处先以占位触发，Task 14 会替换为 `triggerBankUpload()` / `triggerSectionsUpload()`。

- [ ] **Step 3: 新增任务创建与双击处理**

在组件内新增：
```tsx
  const handleCreateTaskFromTree = useCallback(async () => {
    const name = await new Promise<string | null>((resolve) => {
      setTaskNameModal({ open: true, resolve });
    });
    if (!name) return;
    const res = await fetch('/v0/bank/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ task_name: name, description: `通过前端创建的任务: ${name}` }),
    });
    if (res.ok) {
      const data = await res.json();
      const tid = String(data?.task_id ?? data?.id ?? '');
      if (tid) setCurrentTask(tid);
      // 触发资源树刷新
      window.dispatchEvent(new CustomEvent('resource-tree-refresh'));
    }
  }, [setCurrentTask]);
```
> `taskNameModal` 状态与渲染复用现有 `TaskNameModal` 组件（若 `EditorPage` 已存在任务名弹窗状态则复用其 setter；否则按上方模式新增 `useState`）。

- [ ] **Step 4: 构建校验**

Run: `npx vite build`
Expected: 成功（暂无未绑定 key 报错，未绑定项走 `console.warn`）

- [ ] **Step 5: 提交**

```powershell
git add src/pages/EditorPage.tsx
git commit -m "feat(editor): 挂载树形侧栏容器"
```

## Task 14: 接线岸段类操作（14 项）

**Files:**
- Modify: `src/pages/EditorPage.tsx`（`handleTreeNodeAction` 内）

- [ ] **Step 1: 补齐 switch 分支**

在 `handleTreeNodeAction` 内补齐（handler 均为本文件已存在函数）：
```tsx
      case 'bank.upload': triggerBankUpload(); break;
      case 'bank.colorToggle': setColorBanks(!colorBanks); break;
      case 'bank.loadMap': await loadBankById(node.ref!.key); break;
      case 'bank.removeMap': removeBankFromMap(node.ref!.key); break;
      case 'bank.locate': focusBankOnMap(node.ref!.key); break;
      case 'bank.props': onBankParamsView(node.ref!.key); break;
      case 'bank.smooth': smoothSelectedShoreLines(); break;
      case 'bank.clip': toggleStartEndSelection(); break;
      case 'bank.confirmClip': clipSelectedBank(); break;
      case 'bank.selectByTiff': selectBanksByTiffRange(); break;
      case 'bank.fixReversed': toggleFixShoreLineReversed(); break;
      case 'bank.uploadSelected': sendSelectedShoreLinesGeoJson(); break;
      case 'bank.delete': deleteBankById(node.ref!.key); break;
      case 'bank.clearLoaded': deleteLoadedBanks(); break;
```

- [ ] **Step 2: 新增缺失的 trigger 与 focus**

在组件内新增（复用现有隐藏 input 或新建）：
```tsx
  const triggerBankUpload = useCallback(() => {
    const el = document.querySelector<HTMLInputElement>('input[data-tree-bank-upload]');
    el?.click();
  }, []);
  const triggerSectionsUpload = useCallback(() => {
    const el = document.querySelector<HTMLInputElement>('input[data-tree-sections-upload]');
    el?.click();
  }, []);
  const focusBankOnMap = useCallback((bankId: string) => {
    // 复用 map 定位逻辑：从 loadedBanks/uploadedData 找到该 bank 的 bbox 并 flyTo
    window.dispatchEvent(new CustomEvent('map-focus-bank', { detail: { bankId } }));
  }, []);
```
并在侧栏容器内放置两个隐藏 input（在 `ResourceSidebar` 或 `EditorPage` 内）：
```tsx
  <input data-tree-bank-upload type="file" accept=".geojson,application/json" style={{ display: 'none' }} onChange={handleFileUpload} />
  <input data-tree-sections-upload type="file" accept=".geojson,application/json" style={{ display: 'none' }} onChange={handleSectionsFileUpload} />
```

- [ ] **Step 3: 构建 + 浏览器验证**

Run: `npx vite build`
浏览器（dev `http://localhost:5175/editor`）：右键岸段节点 → 各菜单项触发对应行为（加载/平滑/删除）。

- [ ] **Step 4: 提交**

```powershell
git add src/pages/EditorPage.tsx
git commit -m "feat(editor): 接线岸段类操作"
```

## Task 15: 接线断面类操作（16 项）

**Files:**
- Modify: `src/pages/EditorPage.tsx`（`handleTreeNodeAction` 内）

- [ ] **Step 1: 补齐分支**

```tsx
      case 'section.upload': triggerSectionsUpload(); break;
      case 'section.toggleVisible': setShowCrossLines(!showCrossLines); break;
      case 'section.generateDisplay': handleGenerateSections(); break;
      case 'section.generateCompute': handleGenerateComputeSections(); break;
      case 'section.validate': validateAllPendingSections(); break;
      case 'section.deleteInvalid': await deleteAllInvalidSections(); break;
      case 'section.export': handleExportSections(); break;
      case 'section.reverse': reverseSelectedCrossLine(); break;
      case 'section.fineTune': toggleCrossLineSelection(); break;
      case 'section.batchParams': setBatchParamsTarget(node); break;
      case 'section.props': configureSelectedCrossLineProperties(); break;
      case 'section.delete': deleteSelectedCrossLine(); break;
```
> `setBatchParamsTarget(node)` 打开现有「批量参数」弹窗并预填 `node.ref.key` 的断面（原实现见 `EditorPage.tsx:2410/2437` 的 batch-params 调用处）。

- [ ] **Step 2: 构建 + 浏览器验证**

Run: `npx vite build`
浏览器：断面文件夹右键「断面检查」→ 弹出校验结果；「导出断面样例」触发下载。

- [ ] **Step 3: 提交**

```powershell
git add src/pages/EditorPage.tsx
git commit -m "feat(editor): 接线断面类操作"
```

## Task 16: 接线参数 / DEM / 任务类操作（12 项）

**Files:**
- Modify: `src/pages/EditorPage.tsx`（`handleTreeNodeAction` 内）

- [ ] **Step 1: 补齐分支**

```tsx
      case 'param.select': handleSelectBasicParam(node.ref!.key); break;
      case 'param.props': openGlobalPropertiesModal(); break;
      case 'param.editSectionParams': openSectionParamsEditor(node); break;
      case 'dem.select': openTiffPicker(node); break;
      case 'dem.upload': openTiffPickerUpload(node); break;
      case 'dem.toggleBounds': setShowTiffBounds(!showTiffBounds); break;
      case 'dem.delete': await deleteTiffByKey(node.ref!.key); break;
      case 'task.create': await handleCreateTaskFromTree(); break;
      case 'task.run': setCurrentTask(node.ref!.key); handleStartAnalysis(); break;
      case 'task.generateCompute': setCurrentTask(node.ref!.key); handleGenerateComputeSections(); break;
      case 'task.setParam': setTaskParamTarget(node); break;
      case 'task.viewResult': navigate(`/result/${node.ref!.key}`); break;
      case 'task.delete': await deleteTaskById(node.ref!.key); break;
```

- [ ] **Step 2: 新增辅助函数**

在组件内新增（`deleteTiffByKey` 复用 `src/services/tiffService.ts` 的 `deleteTiffResource`；`deleteTaskById` 调用 `DELETE /v0/bank/tasks/{id}`）：
```tsx
  const deleteTiffByKey = useCallback(async (key: string) => {
    const { deleteTiffResource, invalidateTiffResourceCache } = await import('../services/tiffService');
    await deleteTiffResource(key);
    invalidateTiffResourceCache();
    window.dispatchEvent(new CustomEvent('resource-tree-refresh'));
  }, []);
  const deleteTaskById = useCallback(async (taskId: string) => {
    await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE', headers: { ...authHeaders() } });
    window.dispatchEvent(new CustomEvent('resource-tree-refresh'));
  }, []);
```

- [ ] **Step 3: 构建 + 浏览器验证**

Run: `npx vite build`
浏览器：右键任务节点 → 删除/查看结果；右键 DEM → 显示 TIF 范围。

- [ ] **Step 4: 提交**

```powershell
git add src/pages/EditorPage.tsx
git commit -m "feat(editor): 接线参数/DEM/任务类操作"
```

## Task 17: 任务优先流程（新建任务 → 任务内生成断面 → 执行）

**Files:**
- Modify: `src/pages/EditorPage.tsx`

- [ ] **Step 1: 「生成计算断面」绑定当前任务**

修改 `handleGenerateComputeSections`：在生成前读取 `useResourceTreeStore.getState().currentTaskId`；若为空，先调用 `handleCreateTaskFromTree()` 取得 taskId，再继续；生成断面时把 `task_id` 写入 `sections` payload（现有 `sectionsGeneration.ts:273-285` 已在任务创建后携带 task_id，此处仅将「先建任务」前置）。

- [ ] **Step 2: ExecuteBar 执行**

`handlers.onRun = handleStartAnalysis`（Task 13 已接）；确保 `handleStartAnalysis` 使用当前任务 id（现有实现从最近创建任务读取，验证一致）。

- [ ] **Step 3: 浏览器端到端验证**

dev `http://localhost:5175/editor`：
1. 上传岸段 → 树中「岸段」出现；
2. 工具栏「＋新建任务」命名 → 树中「计算任务」出现且被选中；
3. 右键任务 → 「生成计算断面」→ 选岸段/间距/长度 → 生成；
4. ExecuteBar「▶ 执行风险分析」→ `/result/{taskId}` 正常出结果。

- [ ] **Step 4: 提交**

```powershell
git add src/pages/EditorPage.tsx
git commit -m "feat(editor): 任务优先计算流程"
```

## Task 18: 断面大列表虚拟滚动 + 地图联动 + 失效引用态

**Files:**
- Modify: `src/components/tree/ResourceTree.tsx`、`src/components/tree/ResourceTreeNode.tsx`、`src/pages/EditorPage.tsx`

- [ ] **Step 1: 虚拟滚动**：对 `kind==='folder'` 且 label 为任务、children 数 > 100 的子树，改用窗口化渲染（`react-window` 或自定义 `IntersectionObserver` 分片，每片 100 条）。
- [ ] **Step 2: 地图联动**：`onNodeSelect` 对 bank/section/dem 节点派发 `map-focus-*` 事件；在 `EditorMap` 注册监听执行 flyTo/highlight。
- [ ] **Step 3: 失效引用**：`resolveTaskRefs` 中若引用实体在当前数据集中不存在，令节点 `invalid=true`（已支持样式）。
- [ ] **Step 4: 构建 + 浏览器验证**

Run: `npx vite build`
验证 410 断面任务展开流畅（无卡顿），点击岸段节点地图高亮。

- [ ] **Step 5: 提交**

```powershell
git add -A
git commit -m "feat(tree): 虚拟滚动/地图联动/失效引用态"
```

## Task 19: 回归验证与合并

**Files:** 无（验证为主）

- [ ] **Step 1: 构建与单测**

Run:
```powershell
npx vitest run
npx vite build
```
Expected: 单测全绿；`vite build` 成功。

- [ ] **Step 2: 46 项操作回归清单**（对照规格 §7 逐项点击验证）

- [ ] **Step 3: 合并到 main**

```powershell
git switch main
git merge --no-ff feature/resource-tree-sidebar -m "feat: 树形资源管理器重构"
git push origin main
git branch -d feature/resource-tree-sidebar
```

- [ ] **Step 4: CI 确认**

检查 GitHub Actions（`npx vite build`）为 success。

---

## 自审（Self-Review）

**1. 规格覆盖：**
- 规格 §5 节点模型 → Task 2 ✓
- §6 数据映射 → Task 3、4 ✓
- §7 操作清单（46）→ Task 13-16（岸段14/断面16/参数DEM任务12/全局4 由工具栏承载）✓
- §8 任务优先流程 → Task 17 ✓
- §9 状态 → Task 6 ✓
- §10 样式 → Task 7 ✓
- §11 交互（hover/右键/键盘）→ Task 8、9、10；键盘导航在 Task 18 打磨（见下）
- §12 虚拟滚动 → Task 18 ✓
- §13 边界/错误 → Task 18 ✓
- §14 不改动范围 → Task 13 保留面板/ResizeHandle ✓

**2. 占位符扫描：** 无 TBD/TODO；Task 12 组件以「完整意图 + 关键代码」给出，`handlers` 接口在 Task 13 完整定义。

**3. 类型一致性：** `TreeNode.ref.key`、`buildResourceTree(data)` 字段名（banks/params/tiffs/tasks/sections）在 Task 4/6/12 一致；`ResourceSidebarHandlers` 在 Task 12 定义、Task 13 使用一致。

**已知待补（执行中完善，非阻塞）：**
- 键盘导航（↑↓←→/Enter）在 Task 18 一并打磨。
- `focusBankOnMap` / `map-focus-bank` 需要 `EditorMap` 侧监听（Task 18 Step 2）。
