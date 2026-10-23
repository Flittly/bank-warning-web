import { describe, it, expect } from 'vitest';
import { buildBanksFolder, buildParamsFolder, buildDemFolder, buildSectionsFolder, buildTasksGroup, buildRulesGroup, resolveTaskRefs, buildResourceTree, flattenTree } from './treeModel';

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

  // 文件夹右键菜单靠 node.actions 驱动（ResourceTree.handleContextMenu 在 actions 为空时直接 return）。
  // 这个断言就是"参数模板文件夹右键一定有菜单"的护栏。
  it('exposes 新建参数模板 on the folder context menu', () => {
    const folder = buildParamsFolder([]);
    expect(folder.actions).toEqual(['param.create']);
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

  it('只在 running 的任务上挂「终止运行」，并紧跟在「执行风险分析」后面', () => {
    const group = buildTasksGroup([
      { task_id: 't1', task_name: '跑着的', status: 'running' },
      { task_id: 't2', task_name: '没跑的', status: 'pending' },
      { task_id: 't3', task_name: '跑完的', status: 'partial_failed' },
    ]);
    const [running, pending, failed] = group.children || [];

    expect(running.actions).toEqual([
      'task.props', 'task.run', 'task.stop',
      'task.runPending', 'task.addBanks',
      'task.generateCompute', 'task.setParam',
      'task.copy', 'task.copyWithResults',
      'task.loadMap', 'task.viewResult', 'task.delete',
    ]);
    // 复制与运行状态无关：任何任务都能复制出一份配置（运行中的只是不带结果）
    for (const n of [pending, failed]) {
      expect(n.actions).toContain('task.copy');
      expect(n.actions).toContain('task.copyWithResults');
    }
    // 非 running 一个都不该有：pending/已结束的任务没有可终止的线程
    expect(pending.actions).not.toContain('task.stop');
    expect(failed.actions).not.toContain('task.stop');
    expect(pending.actions).toContain('task.run');
    // 「补充岸段」与运行状态无关：任务是 pending 还是已跑完，都能往里追加岸段
    for (const n of [running, pending, failed]) {
      expect(n.actions).toContain('task.addBanks');
      expect(n.actions).toContain('task.runPending');
    }
    // 「加载岸段与断面到地图」与运行状态无关：任何任务都能把自己的岸段/断面铺到图上
    for (const n of [running, pending, failed]) expect(n.actions).toContain('task.loadMap');
  });

  it('status 的大小写与首尾空格不影响终止入口的出现', () => {
    const group = buildTasksGroup([{ task_id: 't9', status: ' RUNNING ' }]);
    expect(group.children?.[0].actions).toContain('task.stop');
  });

  // 回归：补充岸段成功后 `invalidateSections` 会把断面缓存删掉，
  // 而此时任务节点多半是折叠的 ⇒ ResourceSidebar 不会去重拉。
  // 老逻辑要求 `sectionsByTask[tid]` 为真才建子节点，于是整棵子树退化成
  // 一行「展开以加载…」，用户看到的就是"岸段没补上"。
  // 岸段归属只认 tasks.bank_ids，与断面缓存是否就绪无关。
  it('断面缓存缺失时仍按 tasks.bank_ids 画出岸段节点', () => {
    const group = buildTasksGroup(
      [{ task_id: 't1', task_name: '任务', bank_ids: ['b1', 'b2', 'b3'] }],
      { sectionsByTask: {}, banksById: { b1: { bank_name: '一岸' } } },
    );
    const kids = group.children?.[0].children || [];
    const banksFolder = kids.find((k) => k.id === 'task-banks:t1');
    expect(banksFolder?.children?.map((n) => n.ref?.key)).toEqual(['b1', 'b2', 'b3']);
    expect(banksFolder?.meta).toBe('3');
    // 库里查不到名字的岸段退回显示 bank_id，而不是消失
    expect(banksFolder?.children?.[0].label).toBe('一岸');
    expect(banksFolder?.children?.[2].label).toBe('b3');
    expect(kids).not.toContainEqual(expect.objectContaining({ id: 'task-loading:t1' }));
  });

  it('断面缓存缺失时「断面」文件夹显示 … 而不是 0，避免被读成"没有断面"', () => {
    const group = buildTasksGroup([{ task_id: 't1', bank_ids: ['b1'] }], { sectionsByTask: {} });
    const kids = group.children?.[0].children || [];
    expect(kids.find((k) => k.id === 'task-sections:t1')?.meta).toBe('…');
  });

  it('既无缓存也无 bank_ids 时才退化成「展开以加载…」', () => {
    const group = buildTasksGroup([{ task_id: 't1' }], { sectionsByTask: {} });
    expect(group.children?.[0].children?.[0].id).toBe('task-loading:t1');
  });

  // 回归：线上真实数据 —— tasks.bank_ids 17 条，断面里还多出 2 条真实岸段
  // （当年"补充岸段"写关联失败留下的），外加 2 条自由断面的 line-N 占位 id。
  // 地图侧取并集并剔除占位 id ⇒ 19 条；树若只读 bank_ids 就是 17 条，
  // 同一个任务两个数字，用户无从判断。
  it('岸段节点 = bank_ids ∪ 断面引用（剔除 line-N 占位 id），与地图同口径', () => {
    const sections = [
      { section_id: 's1', bank_id: 'bankwgs84_5' },
      { section_id: 's2', bank_id: 'bankwgs84_11' },
      { section_id: 's3', bank_id: 'line-9' },
    ];
    const group = buildTasksGroup(
      [{ task_id: 't1', bank_ids: ['bankwgs84_5', 'bankwgs84_4'] }],
      { sectionsByTask: { t1: sections } },
    );
    const kids = group.children?.[0].children || [];
    const banksFolder = kids.find((k) => k.id === 'task-banks:t1');
    // 任务顺序在前，未登记的追加在后；line-9 不是岸段
    expect(banksFolder?.children?.map((n) => n.ref?.key)).toEqual([
      'bankwgs84_5',
      'bankwgs84_4',
      'bankwgs84_11',
    ]);
    expect(banksFolder?.meta).toBe('3');
    // 自由断面依旧留在「断面」文件夹里，只是分组名不再叫 line-9
    const sectionFolders = kids.find((k) => k.id === 'task-sections:t1')?.children || [];
    expect(sectionFolders.map((f) => f.label)).toContain('自由断面');
    expect(sectionFolders.map((f) => f.meta)).toEqual(['1', '1', '1']);
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

describe('buildResourceTree', () => {
  it('builds root with resources and tasks groups', () => {
    const root = buildResourceTree({ banks: [{ bank_id: 'b1' }], params: [], tiffs: [], tasks: [{ task_id: 't1', task_name: 'X' }], sections: [] });
    expect(root.id).toBe('root');
    const groupIds = (root.children || []).map((c) => c.id);
    expect(groupIds).toContain('group:resources');
    expect(groupIds).toContain('group:tasks');
    const resources = root.children?.find((c) => c.id === 'group:resources');
    expect(resources?.children?.length).toBe(4);
    expect(resources?.children?.map((c) => c.id)).toEqual(['folder:banks', 'folder:sections', 'folder:params', 'folder:dems']);
  });
  // 「岸段」文件夹原本只有上传 + 着色开关；库里上百条岸段逐条点「加载到地图」不现实。
  // 这对批量动作与断面文件夹的 section.loadAll / section.removeAll 同义对称。
  it('gives the 岸段 folder the batch pair, mirroring the 断面 folder', () => {
    const root = buildResourceTree({ banks: [{ bank_id: 'b1' }], params: [], tiffs: [], tasks: [], sections: [] });
    const resources = root.children?.find((c) => c.id === 'group:resources');
    const banksFolder = resources?.children?.find((c) => c.id === 'folder:banks');
    const sectionsFolder = resources?.children?.find((c) => c.id === 'folder:sections');
    expect(banksFolder?.actions).toContain('bank.loadAll');
    expect(banksFolder?.actions).toContain('bank.removeAll');
    // 断面侧保持原样，两侧都要有同一对语义
    expect(sectionsFolder?.actions).toContain('section.loadAll');
    expect(sectionsFolder?.actions).toContain('section.removeAll');
  });
});

describe('buildRulesGroup', () => {
  it('夹在「数据资源」与「计算任务」之间', () => {
    const root = buildResourceTree({ banks: [], params: [], tiffs: [], tasks: [], sections: [] });
    expect((root.children || []).map((c) => c.id)).toEqual(['group:resources', 'group:rules', 'group:tasks']);
  });

  it('三层结构：group → 三个分类 → 九个规则叶子', () => {
    const group = buildRulesGroup({ enabled: {}, layers: { river: false, tiff: false } });
    expect(group.kind).toBe('group');
    expect(group.children?.map((c) => c.id)).toEqual([
      'rules-cat:space', 'rules-cat:quality', 'rules-cat:param',
    ]);
    const leaves = group.children?.flatMap((c) => c.children || []) || [];
    expect(leaves.length).toBe(9);
    expect(leaves.every((n) => n.kind === 'rule' && n.selectable === false)).toBe(true);
    // 规则不是数据资产：不可选中，避免污染多选与批量操作条
    expect(leaves.some((n) => n.selectable)).toBe(false);
  });

  it('锁定规则没有 rule.toggle，可关规则带开关与图层', () => {
    const group = buildRulesGroup({ enabled: {}, layers: { river: true, tiff: false } });
    const leaves = group.children?.flatMap((c) => c.children || []) || [];
    const byId = new Map(leaves.map((n) => [n.id, n]));

    const river = byId.get('rule:R-SPACE-01');
    expect(river?.actions).toEqual(['rule.toggle', 'rule.layer', 'rule.describe']);
    expect(river?.rule).toMatchObject({ enabled: true, locked: false, layer: 'river', layerOn: true });
    expect(river?.meta).toBe('启用');

    // R-SPACE-02 共用长江图层，不重复给眼睛
    expect(byId.get('rule:R-SPACE-02')?.actions).toEqual(['rule.toggle', 'rule.describe']);

    const bench = byId.get('rule:R-SPACE-03');
    expect(bench?.actions).toEqual(['rule.describe']);
    expect(bench?.rule?.locked).toBe(true);
    // 锁定行不写 meta：行尾的锁 + 「固定」已经说明白了
    expect(bench?.meta).toBeUndefined();

    const qual = byId.get('rule:R-QUAL-01');
    expect(qual?.actions).toEqual(['rule.describe']);
  });

  it('停用后行状态与分类计数同步变化', () => {
    const group = buildRulesGroup({
      enabled: { 'R-SPACE-01': false },
      layers: { river: false, tiff: false },
    });
    const space = group.children?.find((c) => c.id === 'rules-cat:space');
    const rivers = space?.children?.find((c) => c.id === 'rule:R-SPACE-01');
    expect(rivers?.meta).toBe('已停用');
    expect(space?.meta).toBe('2/3');
    // 组头只统计可关规则（3 条），锁定规则不计入分母
    expect(group.meta).toBe('2/3');
  });
});

describe('flattenTree', () => {
  it('includes only expanded descendants, with depth', () => {
    const root: any = { id: 'root', children: [{ id: 'a', children: [{ id: 'a1', children: [{ id: 'a1x' }] }] }] };
    expect(flattenTree(root, {}).map((r) => r.node.id)).toEqual(['a']);
    const rows = flattenTree(root, { a: true, a1: true });
    expect(rows.map((r) => r.node.id)).toEqual(['a', 'a1', 'a1x']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });
  it('handles empty root', () => {
    expect(flattenTree({ id: 'root' } as any, {})).toEqual([]);
  });
});

describe('buildTasksGroup task children', () => {
  it('attaches 岸段/断面/参数/DEM when sections loaded', () => {
    const tasks = [{ task_id: 't1', task_name: '任务A', bank_ids: ['b1'] }];
    const sectionsByTask = {
      t1: [
        { section_id: 's1', section_name: '断面1', bank_id: 'b1', param_name: '默认', basic_param_id: 159, bench_id: 'tiff/A.tif', ref_id: 'tiff/B.tif', validation_status: 'valid' },
        { section_id: 's2', bank_id: 'b1', validation_status: 'invalid' },
      ],
    };
    const banksById = { b1: { bank_id: 'b1', bank_name: '岸段一' } };
    const group = buildTasksGroup(tasks, { sectionsByTask, banksById });
    const task = group.children![0];
    expect((task.children || []).map((c) => c.id)).toEqual(['task-banks:t1', 'task-sections:t1', 'task-param:t1', 'task-dems:t1']);
    const banksFolder = task.children!.find((c) => c.id === 'task-banks:t1')!;
    expect(banksFolder.children?.[0].label).toBe('岸段一');
    // 任务下的「岸段」文件夹也要有与断面文件夹对称的批量动作对（全部加载/全部移出地图）。
    expect(banksFolder.actions).toContain('bank.loadAll');
    expect(banksFolder.actions).toContain('bank.removeAll');
    const sectionsFolder = task.children!.find((c) => c.id === 'task-sections:t1')!;
    expect(sectionsFolder.meta).toBe('2');
    const bankFolder = sectionsFolder.children![0];
    expect(bankFolder.children?.length).toBe(2);
    expect(bankFolder.children?.[1].invalid).toBe(true);
    const dems = task.children!.find((c) => c.id === 'task-dems:t1')!;
    expect(dems.children?.length).toBe(2);
  });
  it('adds a loading placeholder when sections not loaded', () => {
    const group = buildTasksGroup([{ task_id: 't2', task_name: 'B' }]);
    expect(group.children![0].children?.[0].label).toContain('展开以加载');
  });
});
