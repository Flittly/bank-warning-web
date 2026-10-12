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

  'section.upload': { key: 'section.upload', label: '上传断面', icon: 'upload' },
  'section.toggleVisible': { key: 'section.toggleVisible', label: '显示/隐藏设计', icon: 'eye' },
  // 把（已被移出地图的）断面重新拉回地图。岸段「移出地图」会连带摘掉其断面，
  // 这是唯一能把断面找回来的入口，故与 bank.loadMap 同名同义。
  'section.loadMap': { key: 'section.loadMap', label: '加载到地图', icon: 'eye' },
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
  'task.props': { key: 'task.props', label: '任务属性', icon: 'settings' },
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
