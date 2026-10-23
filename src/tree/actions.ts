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
  'bank.props': { key: 'bank.props', label: '参数配置', icon: 'settings' },
  'bank.info': { key: 'bank.info', label: '属性', icon: 'settings' },
  'bank.smooth': { key: 'bank.smooth', label: '平滑岸段', icon: 'zap' },
  'bank.clip': { key: 'bank.clip', label: '截取岸段', icon: 'scissors' },
  'bank.confirmClip': { key: 'bank.confirmClip', label: '确认截取', icon: 'check' },
  'bank.selectByTiff': { key: 'bank.selectByTiff', label: '按 TIF 选岸段', icon: 'layers' },
  'bank.fixReversed': { key: 'bank.fixReversed', label: '修正选择(反向)', icon: 'rotate' },
  'bank.uploadSelected': { key: 'bank.uploadSelected', label: '上传选中岸段', icon: 'upload' },
  'bank.delete': { key: 'bank.delete', label: '删除岸段', icon: 'trash', danger: true, separatorBefore: true },
  'bank.clearLoaded': { key: 'bank.clearLoaded', label: '清除已加载岸段', icon: 'eraser' },

  // 「岸段」文件夹上的一对批量动作，与下面 section.loadAll / section.removeAll 完全对称。
  // 库里岸段上百条（实测 113 条），逐条点行尾的「加载到地图」不现实。
  'bank.loadAll': { key: 'bank.loadAll', label: '全部加载到地图', icon: 'eye' },
  'bank.removeAll': { key: 'bank.removeAll', label: '全部移出地图', icon: 'eyeOff' },

  'section.upload': { key: 'section.upload', label: '上传断面', icon: 'upload' },
  'section.toggleVisible': { key: 'section.toggleVisible', label: '显示/隐藏设计', icon: 'eye' },
  // 把（已被移出地图的）断面重新拉回地图。岸段「移出地图」会连带摘掉其断面，
  // 这是唯一能把断面找回来的入口，故与 bank.loadMap 同名同义。
  'section.loadMap': { key: 'section.loadMap', label: '加载到地图', icon: 'eye' },
  // 文件夹级「开关」：一次把该文件夹下（含嵌套）的所有断面拉回 / 摘出地图。
  // 单个断面的动作只能一条条点，断面多时很烦，故在"装着断面的文件夹"上补一对批量动作。
  'section.loadAll': { key: 'section.loadAll', label: '全部加载到地图', icon: 'eye' },
  'section.removeAll': { key: 'section.removeAll', label: '全部移出地图', icon: 'eyeOff' },
  'section.generateDisplay': { key: 'section.generateDisplay', label: '生成展示断面', icon: 'ruler' },
  'section.generateCompute': { key: 'section.generateCompute', label: '生成计算断面', icon: 'ruler' },
  'section.validate': { key: 'section.validate', label: '断面检查', icon: 'checkCircle' },
  'section.deleteInvalid': { key: 'section.deleteInvalid', label: '一键删除无效断面', icon: 'trash' },
  'section.export': { key: 'section.export', label: '导出断面样例', icon: 'download' },
  'section.reverse': { key: 'section.reverse', label: '反切', icon: 'rotate' },
  'section.fineTune': { key: 'section.fineTune', label: '进入精细调整', icon: 'move' },
  'section.batchParams': { key: 'section.batchParams', label: '断面批量参数', icon: 'settings' },
  'section.props': { key: 'section.props', label: '断面参数', icon: 'settings' },
  'section.info': { key: 'section.info', label: '属性', icon: 'settings' },
  'section.delete': { key: 'section.delete', label: '删除断面', icon: 'trash', danger: true, separatorBefore: true },

  // 「参数模板」文件夹上的新建入口。此前该文件夹没有任何动作（右键无菜单），
  // 想加新模板只能先随便打开一个已有模板、用属性弹窗里的「复制」按钮 + window.prompt 生成副本，
  // 且 param_id 由 `名称_copy_时间戳` 拼出来 —— 中文名会被整段丢掉，副本名还常常和原名对不上。
  'param.create': { key: 'param.create', label: '新建参数模板', icon: 'plus' },
  'param.select': { key: 'param.select', label: '设为当前/任务引用', icon: 'check' },
  'param.props': { key: 'param.props', label: '模板属性配置', icon: 'settings' },
  'param.editSectionParams': { key: 'param.editSectionParams', label: '编辑断面参数', icon: 'settings' },
  'param.info': { key: 'param.info', label: '属性', icon: 'settings' },

  'dem.upload': { key: 'dem.upload', label: '上传自定义 DEM', icon: 'upload' },
  'dem.select': { key: 'dem.select', label: '选择 DEM', icon: 'layers' },
  'dem.selectBanks': { key: 'dem.selectBanks', label: '按此 DEM 选岸段', icon: 'layers' },
  'dem.toggleBounds': { key: 'dem.toggleBounds', label: '显示/隐藏 TIF 范围', icon: 'eye' },
  'dem.delete': { key: 'dem.delete', label: '删除 DEM', icon: 'trash', danger: true, separatorBefore: true },
  'dem.info': { key: 'dem.info', label: '属性', icon: 'settings' },

  'task.create': { key: 'task.create', label: '新建任务', icon: 'plus' },
  // 与「双击任务节点」同义：把这个任务的岸段与断面整体铺到地图上（先清掉图上原有的）。
  // 双击是新用户最直觉的入口，但右键菜单要留一份，才知道这个能力存在。
  'task.loadMap': { key: 'task.loadMap', label: '加载岸段与断面到地图', icon: 'eye' },
  'task.props': { key: 'task.props', label: '任务属性', icon: 'settings' },
  'task.run': { key: 'task.run', label: '执行风险分析', icon: 'play' },
  // 只在任务确实 running 时才会挂到节点动作里（见 treeModel 按 status 拼 actions），
  // 所以这里不需要再做条件判断；danger 是为了让它在右键菜单里就是红色的。
  'task.stop': { key: 'task.stop', label: '终止运行', icon: 'stop', danger: true },
  'task.generateCompute': { key: 'task.generateCompute', label: '生成计算断面…', icon: 'ruler' },
  // 「补充岸段」是"增量"动作：只往该任务追加新岸段与断面，已有断面/结果不动。
  // 与 task.generateCompute（整任务清空重建）语义相反，所以文案上必须能一眼分开。
  'task.addBanks': { key: 'task.addBanks', label: '补充岸段…', icon: 'plus' },
  // 只算「还没有结果」的断面：补完岸段不想等全量重跑时用。
  'task.runPending': { key: 'task.runPending', label: '只算未计算断面', icon: 'play' },
  // 打开的是「本任务」自己的参数集（basic_params.task_id = 该任务），不是模板库那份。
  'task.setParam': { key: 'task.setParam', label: '编辑本任务参数…', icon: 'settings' },
  // 复制任务：只搬「配置 + 断面几何 + 参数集」，状态重置为 pending，不复制计算结果。
  // 与「含结果」拆成两个菜单项，是为了不在弹窗里再塞一个勾选框 ——
  // 复制结果会带来「这批结论不是本任务算的」的语义，用户应该在点之前就知道自己在要什么。
  'task.copy': { key: 'task.copy', label: '复制任务', icon: 'copy' },
  'task.copyWithResults': { key: 'task.copyWithResults', label: '复制任务（含计算结果）', icon: 'copy' },
  'task.viewResult': { key: 'task.viewResult', label: '查看结果', icon: 'chart' },
  // 「分析」= 在地图上框一块区域，统计区内各风险等级的占比与长度（不写库、不改任务）。
  // 与「查看结果」的区别：后者是整任务的表格/报告视角，前者是"只看我圈起来的这一块"。
  // 图标用 layers 而不是 chart —— 菜单里已经有一个 chart（查看结果），两个同图标会看串。
  'task.delete': { key: 'task.delete', label: '删除任务', icon: 'trash', danger: true, separatorBefore: true },

  // —— 校验规则（树里与「数据资源」「计算任务」并列的「规则」节点）——
  // `rule.toggle` / `rule.layer` 只挂在**可关**规则上（见 buildRulesGroup 的 actions 拼装），
  // 锁定规则只有 rule.describe：菜单里出现"停用"而点了没反应，比没有这个菜单项更糟。
  'rule.toggle': { key: 'rule.toggle', label: '启用 / 停用', icon: 'check' },
  // 图层开关与规则开关正交：可以启用规则但不画边界（省 942KB），也可以停用规则仍看边界。
  'rule.layer': { key: 'rule.layer', label: '显示 / 隐藏判定范围', icon: 'eye' },
  'rule.describe': { key: 'rule.describe', label: '规则说明', icon: 'settings' },
  'rule.create': { key: 'rule.create', label: '新增规则…', icon: 'plus' },

  'global.clear': { key: 'global.clear', label: '清空', icon: 'eraser' },
  'global.satellite': { key: 'global.satellite', label: '卫星图', icon: 'globe' },
  'global.uploadBank': { key: 'global.uploadBank', label: '上传岸段', icon: 'upload' },
  'global.uploadSections': { key: 'global.uploadSections', label: '上传断面', icon: 'upload' },
};

export function getActions(keys: ActionKey[] = []): ActionMeta[] {
  return keys.map((k) => ACTION_META[k]).filter(Boolean);
}
