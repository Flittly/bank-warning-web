import type { TreeNode } from './types';
// 「什么算 running」全仓只允许有一个定义（后端的字面量写在 TaskMapper.xml 的 markRunning）。
// 这里刻意复用下半区面板那份，而不是再抄一遍字符串比较 —— 那正是两处口径慢慢漂移的起点。
import { isRunningStatus } from '../components/tree/loadedOnMap';
import { RULE_CATALOG, RULE_CATEGORIES, SWITCHABLE_RULES, isRuleOn } from '../rules/catalog';
// 「任务的岸段清单」口径唯一真源：树、地图、补充岸段候选必须同源，
// 否则会出现「树里 17 条、地图上 19 条」这种自相矛盾的界面。
import { isSyntheticBankId, resolveTaskBankIds } from './taskBankIds';

export function buildBanksFolder(banks: any[]): TreeNode {
  const children: TreeNode[] = (banks || [])
    .filter((b) => {
      const id = String(b?.bank_id || '');
      return id && !id.includes('_clip_');
    })
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
          'bank.loadMap', 'bank.locate', 'bank.props', 'bank.info', 'bank.smooth',
          'bank.clip', 'bank.selectByTiff', 'section.toggleVisible', 'bank.delete',
        ],
      };
    });
  // 与「断面」文件夹对称：文件夹上挂一对批量动作（全部加载到地图 / 全部移出地图）。
  // 岸段库里上百条时，只能逐条点行尾的「加载到地图」是同一类痛点，之前只补了断面那一侧。
  // 这对 key 只在右键菜单与行尾出现（FOLDER_HOVER_KEYS 控制），不会给单条岸段加图标。
  return { id: 'folder:banks', kind: 'folder', label: '岸段', icon: 'bank', selectable: false, meta: String(children.length), children, actions: ['bank.upload', 'bank.colorToggle', 'bank.loadAll', 'bank.removeAll'] };
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
      actions: ['param.select', 'param.props', 'param.info', 'param.editSectionParams'],
    };
  });
  // actions 只放「新建参数模板」：文件夹右键菜单由它驱动。
  // ResourceTreeNode 的 FOLDER_HOVER_KEYS 会把它挡在行尾图标之外，
  // 所以这个动作只出现在右键菜单里，不会让文件夹行凭空多一个加号。
  return { id: 'folder:params', kind: 'folder', label: '参数模板', icon: 'param', selectable: false, meta: String(children.length), children, actions: ['param.create'] };
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
      actions: ['dem.toggleBounds', 'dem.selectBanks', 'dem.info', 'dem.delete'],
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
  const total = children.reduce((n, seg) => n + (seg.children?.reduce((m, y) => m + (y.children?.length || 0), 0) || 0), 0);
  return { id: 'folder:dems', kind: 'folder', label: 'DEM 资源', icon: 'dem', selectable: false, meta: String(total), children, actions: ['dem.upload'] };
}

export function buildSectionsFolder(sections: any[], tasks?: any[]): TreeNode {
  const byTask = new Map<string, { name: string; nodes: TreeNode[] }>();
  const taskNameOf = (taskId: string) => {
    const t = (tasks || []).find((x) => String(x?.task_id ?? x?.id) === taskId);
    return t?.task_name || t?.taskName || taskId;
  };
  for (const s of sections || []) {
    const taskId = String(s?.task_id ?? 'unknown');
    const secId = String(s?.section_id || s?.id || '');
    if (!secId) continue;
    if (!byTask.has(taskId)) byTask.set(taskId, { name: String(s?.task_name || taskNameOf(taskId)), nodes: [] });
    byTask.get(taskId)!.nodes.push({
      id: `section:${taskId}:${secId}`,
      kind: 'section',
      label: `#${secId}`,
      icon: 'section',
      meta: s?.bank_id ? String(s.bank_id) : undefined,
      ref: { entity: 'section', key: secId },
      selectable: true,
      actions: ['section.loadMap', 'section.reverse', 'section.props', 'section.info', 'section.delete'],
    });
  }
  const children: TreeNode[] = [...byTask.entries()].map(([taskId, g]) => ({
    id: `sections-task:${taskId}`,
    kind: 'folder',
    label: g.name,
    selectable: false,
    meta: String(g.nodes.length),
    children: g.nodes,
    actions: ['section.validate', 'section.deleteInvalid', 'section.export', 'section.reverse', 'section.batchParams', 'section.fineTune', 'section.loadAll', 'section.removeAll'],
  }));
  const total = children.reduce((n, g) => n + (g.children?.length || 0), 0);
  return { id: 'folder:sections', kind: 'folder', label: '断面', icon: 'section', selectable: false, meta: String(total), children, actions: ['section.upload', 'section.generateDisplay', 'section.toggleVisible', 'section.loadAll', 'section.removeAll'] };
}

export function buildTasksGroup(
  tasks: any[],
  opts?: { sectionsByTask?: Record<string, any[]>; banksById?: Record<string, any> },
): TreeNode {
  const sectionsByTask = opts?.sectionsByTask || {};
  const banksById = opts?.banksById || {};
  const children: TreeNode[] = (tasks || [])
    .filter((t: any) => t?.task_id != null || t?.id != null)
    .map((t: any) => {
      const tid = String(t.task_id ?? t.id);
      const secs = sectionsByTask[tid];
      const taskBankIds: string[] = Array.isArray(t.bank_ids)
        ? t.bank_ids.map((b: any) => String(b ?? '').trim()).filter(Boolean)
        : [];
      // 断面缓存没到（未展开 / 刚被 invalidate）时，**仍然**按 tasks.bank_ids 把岸段节点画出来。
      // 以前这里要求 `secs` 为真才建子节点，于是「补充岸段成功」之后缓存一作废，
      // 整棵子树会退化成一行「展开以加载…」——用户看到的就是"岸段没补上"。
      // 岸段归属是任务自身的属性（tasks.bank_ids），不该依赖断面缓存是否就绪。
      const hasAnyInfo = Boolean(secs) || taskBankIds.length > 0;
      let kids: TreeNode[];
      if (hasAnyInfo) {
        const sectionList: any[] = secs || [];
        // 岸段清单 = 任务登记 ∪ 断面引用（去掉 line-N 占位 id）。
        // 只用 taskBankIds 会漏掉"有断面但没登记"的岸段（补充岸段写关联失败的历史数据），
        // 而地图侧一直取并集 ⇒ 树比地图少，用户看到的正是"地图上 19 条、任务里 17 条"。
        const { bankIds } = resolveTaskBankIds(
          taskBankIds,
          sectionList.map((s) => String(s?.bank_id || '')),
        );
        const bankLabel = (bid: string) =>
          banksById[bid]?.bank_name || banksById[bid]?.bankName || bid;
        const bankNodes: TreeNode[] = bankIds.map((bid) => ({
          id: `task-bank:${tid}:${bid}`,
          kind: 'bank' as const,
          label: bankLabel(bid),
          icon: 'bank',
          meta: bid,
          ref: { entity: 'bank' as const, key: bid },
          selectable: true,
          actions: ['bank.loadMap', 'bank.locate'],
        }));
        const byBank = new Map<string, any[]>();
        for (const s of sectionList) {
          const bid = String(s.bank_id || '未知');
          if (!byBank.has(bid)) byBank.set(bid, []);
          byBank.get(bid)!.push(s);
        }
        const sectionBankFolders: TreeNode[] = [...byBank.entries()].map(([bid, list]) => ({
          id: `task-sections-bank:${tid}:${bid}`,
          kind: 'folder' as const,
          // 手工画线生成的自由断面 bank_id 是 `line-N` 占位符，显示成 id 毫无信息量
          label: isSyntheticBankId(bid) ? '自由断面' : bankLabel(bid),
          selectable: false,
          meta: String(list.length),
          ref: { entity: 'bank' as const, key: bid },
          actions: ['section.loadAll', 'section.removeAll'],
          children: list.map((s: any) => {
            const sid = String(s.section_id ?? s.id);
            const status = String(s.validation_status || '');
            return {
              id: `task-section:${tid}:${sid}`,
              kind: 'section' as const,
              label: String(s.section_name || s.section_id || sid),
              icon: 'section',
              meta: status && status !== 'valid' ? status : undefined,
              ref: { entity: 'section' as const, key: String(s.section_id ?? sid) },
              selectable: true,
              actions: ['section.loadMap', 'section.props', 'section.info', 'section.delete'],
              invalid: Boolean(status && status !== 'valid'),
            };
          }),
        }));
        const firstWith = (k: string) => sectionList.find((s: any) => s[k] != null && s[k] !== '');
        const paramName = firstWith('param_name')?.param_name;
        const bench = firstWith('bench_id')?.bench_id;
        const refId = firstWith('ref_id')?.ref_id;
        const demChildren: TreeNode[] = [
          bench ? { key: String(bench), label: '基准' } : null,
          refId ? { key: String(refId), label: '对照' } : null,
        ]
          .filter(Boolean)
          .map((d: any) => ({
            id: `task-dem:${tid}:${d.label}`,
            kind: 'dem' as const,
            label: String(d.key).split('/').pop() || String(d.key),
            meta: d.label,
            ref: { entity: 'dem' as const, key: String(d.key) },
            selectable: true,
            actions: ['dem.toggleBounds', 'dem.selectBanks', 'dem.info'],
          }));
        kids = [
          // 「补充岸段」在任务节点和这个「岸段」文件夹上都挂一份：后者的语义更贴
          // （"往这个文件夹里再加几条"），也是用户最可能右键的地方。
          // 文件夹本身不可选中，ref 只用于把 task_id 带到动作处理里。
          {
            id: `task-banks:${tid}`,
            kind: 'folder',
            label: '岸段',
            icon: 'bank',
            selectable: false,
            meta: String(bankNodes.length),
            ref: { entity: 'task' as const, key: tid },
            children: bankNodes,
            actions: ['bank.loadAll', 'bank.removeAll', 'task.addBanks'],
          },
          // 断面缓存还没到时显示「…」而不是 0：0 会被读成"这个任务没有断面"，
          // 而实际只是还没请求回来（ResourceSidebar 会按 expanded 补拉）。
          { id: `task-sections:${tid}`, kind: 'folder', label: '断面', icon: 'section', selectable: false, meta: secs ? String(sectionList.length) : '…', children: sectionBankFolders, actions: ['section.loadAll', 'section.removeAll'] },
          // 任务参数是**本任务自己的一份**（basic_params.task_id = 该任务），不再是「引用」模板库：
          // 改它只影响这个任务，改模板库也不会影响它。入口统一走 task.setParam。
          {
            id: `task-param:${tid}`,
            kind: 'task-ref',
            label: `参数模板: ${paramName || '未设置'}`,
            selectable: false,
            meta: '本任务',
            actions: ['task.setParam'],
            ref: { entity: 'task' as const, key: tid },
          },
          { id: `task-dems:${tid}`, kind: 'task-ref', label: 'DEM', icon: 'dem', selectable: false, children: demChildren },
        ];
      } else {
        kids = [{ id: `task-loading:${tid}`, kind: 'task-ref', label: '展开以加载…', selectable: false }];
      }
      // 「终止运行」只在任务确实 running 时挂上去：pending 的任务没有可终止的线程，
      // 已结束的任务更不该出现这个按钮 —— 动作列表本身要如实反映"现在能对这个任务做什么"。
      // `task.loadMap` 与「双击任务节点」是同一个动作（把本任务的岸段+断面整体铺到地图）。
      // 放在 viewResult 之前，不动 index 2 的位置 —— 下面 running 时的 splice 依赖它。
      // `task.addBanks` / `task.runPending` 是「增量补充」这一对：补岸段、只算新增断面，
      // 与 `task.generateCompute`（整任务清空重建）互斥使用，故紧挨着放、文案可区分。
      const taskActions = [
        'task.props',
        'task.run',
        'task.runPending',
        'task.addBanks',
        'task.generateCompute',
        'task.setParam',
        'task.loadMap',
        'task.viewResult',
        'task.delete',
      ];
      if (isRunningStatus(t?.status)) taskActions.splice(2, 0, 'task.stop');

      return {
        id: `task:${tid}`,
        kind: 'task' as const,
        label: String(t.task_name || tid),
        icon: 'task',
        meta: t?.status ? String(t.status) : undefined,
        ref: { entity: 'task' as const, key: tid },
        selectable: true,
        actions: taskActions,
        children: kids,
      };
    });
  return { id: 'group:tasks', kind: 'group', label: '计算任务', icon: 'tasks', selectable: false, meta: String(children.length), children, actions: ['task.create'] };
}

export function resolveTaskRefs(
  task: any,
  data: { sections?: any[]; paramName?: string; paramKey?: string; bench_id?: string; ref_id?: string },
): TreeNode[] {
  const tid = String(task?.task_id ?? task?.id);
  const secs = data.sections || [];
  const byBank = new Map<string, number>();
  for (const s of secs) {
    const bankKey = String(s.bank_id || '未知');
    byBank.set(bankKey, (byBank.get(bankKey) || 0) + 1);
  }
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
    meta: '本任务',
    actions: ['task.setParam'],
    ref: { entity: 'task', key: tid },
  };
  const demChildren: TreeNode[] = [
    { key: data.bench_id, meta: '基准' },
    { key: data.ref_id, meta: '对照' },
  ]
    .filter((d) => d.key)
    .map((d, i) => ({
      id: `task-ref:${tid}:dem:${i}`,
      kind: 'dem' as const,
      label: String(d.key).split('/').pop() || String(d.key),
      meta: d.meta,
      ref: { entity: 'dem' as const, key: String(d.key) },
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

export interface RuleGroupState {
  /** 规则开关（来自 useRuleStore）。缺省时全部按 catalog 的 defaultOn 渲染 */
  enabled: Record<string, boolean>;
  /** 关联图层当前是否显示（river=长江范围，tiff=DEM 范围） */
  layers: { river: boolean; tiff: boolean };
}

/**
 * 「规则」节点：与「数据资源」「计算任务」并列，下挂三个分类，叶子是规则本身。
 *
 * <p>层级刻意做成三层（group → folder → rule），与「数据资源 → 岸段 → 岸段项」同构：
 * 树里出现第四层会让人怀疑自己点错了地方。
 *
 * <p>叶子**不可选中**（`selectable: false`）：规则不是数据资产，让它进多选集合会污染
 * 批量操作条的类型判定（批量删除/批量参数对一条"规则"没有任何意义）。
 */
export function buildRulesGroup(state?: RuleGroupState): TreeNode {
  const enabled = state?.enabled;
  const layers = state?.layers || { river: false, tiff: false };

  const categories: TreeNode[] = RULE_CATEGORIES.map((cat) => {
    const defs = RULE_CATALOG.filter((r) => r.category === cat.key);
    const switchable = defs.filter((d) => !d.locked);
    const onCount = switchable.filter((d) => isRuleOn(enabled, d.id)).length;
    const children: TreeNode[] = defs.map((d) => {
      const on = isRuleOn(enabled, d.id);
      // 锁定规则不给 rule.toggle —— 右键菜单由 actions 驱动，没有这个 key 就不会出现"停用"
      const actions = d.locked
        ? ['rule.describe']
        : ['rule.toggle', ...(d.layer ? ['rule.layer'] : []), 'rule.describe'];
      return {
        id: `rule:${d.id}`,
        kind: 'rule' as const,
        label: d.label,
        icon: 'rule',
        selectable: false,
        // 可关规则显示"启用/已停用"，锁定规则不重复写 meta —— 行尾的锁 + 「固定」已经说明白了
        meta: d.locked ? undefined : (on ? '启用' : '已停用'),
        // hover 里直接给判定依据：用户不该为了知道"这条在拦什么"去翻文档
        title: d.locked
          ? `${d.label}（固定，不可关闭）— ${d.desc}`
          : `${d.label}（${on ? '启用' : '已停用'}）— ${d.desc}${!on && d.offWarning ? `\n停用后果：${d.offWarning}` : ''}`,
        actions,
        rule: {
          id: d.id,
          enabled: on,
          locked: d.locked,
          layer: d.layer,
          layerOn: d.layer ? layers[d.layer] : undefined,
        },
      };
    });
    return {
      id: `rules-cat:${cat.key}`,
      kind: 'folder' as const,
      label: cat.label,
      selectable: false,
      meta: switchable.length > 0 ? `${onCount}/${switchable.length}` : '固定',
      title: cat.hint,
      children,
    };
  });

  const onAll = SWITCHABLE_RULES.filter((r) => isRuleOn(enabled, r.id)).length;
  return {
    id: 'group:rules',
    kind: 'group',
    label: '规则',
    icon: 'rules',
    selectable: false,
    meta: `${onAll}/${SWITCHABLE_RULES.length}`,
    children: categories,
    actions: ['rule.create'],
  };
}

export function buildResourceTree(data: {
  banks?: any[]; params?: any[]; tiffs?: any[]; tasks?: any[]; sections?: any[];
  sectionsByTask?: Record<string, any[]>;
  rules?: RuleGroupState;
}): TreeNode {
  const banksById: Record<string, any> = {};
  for (const b of data.banks || []) {
    if (b?.bank_id) banksById[String(b.bank_id)] = b;
  }
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
        icon: 'resources',
        selectable: false,
        children: [
          buildBanksFolder(data.banks || []),
          buildSectionsFolder(data.sections || [], data.tasks || []),
          buildParamsFolder(data.params || []),
          buildDemFolder(data.tiffs || []),
        ],
      },
      // 规则夹在两者之间：它是"数据能不能用"的判定，与"有哪些数据""跑过哪些任务"并列，
      // 而不是某个任务的附属品。
      buildRulesGroup(data.rules),
      buildTasksGroup(data.tasks || [], { sectionsByTask: data.sectionsByTask, banksById }),
    ],
  };
}

export interface FlatRow {
  node: TreeNode;
  depth: number;
}

/** 按展开态把树摊平为可见行序列（用于虚拟滚动） */
export function flattenTree(root: TreeNode, expanded: Record<string, boolean>): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (node: TreeNode, depth: number) => {
    rows.push({ node, depth });
    if (node.children && node.children.length > 0 && expanded[node.id]) {
      for (const child of node.children) walk(child, depth + 1);
    }
  };
  for (const child of root.children || []) walk(child, 0);
  return rows;
}
