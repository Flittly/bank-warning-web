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
