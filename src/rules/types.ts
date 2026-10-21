/**
 * 「规则」节点的类型定义。
 *
 * <p>规则 id 是前后端之间唯一的契约字符串：前端拿它渲染开关、后端拿它决定跳过哪条判定。
 * 两边必须逐字一致（见 `SectionValidationService` 里的同名常量），
 * 所以这里用联合类型而不是 string —— 拼错一个字母在 `tsc` 阶段就会报错，
 * 而不是等到用户点了开关发现"没反应"。
 */

/** 规则分类：按"这条规则管什么"分，不按"谁实现的"分 */
export type RuleCategory = 'space' | 'quality' | 'param';

export type RuleId =
  // 断面空间校验（后端 SectionValidationService）
  | 'R-SPACE-01'
  | 'R-SPACE-02'
  | 'R-SPACE-03'
  | 'R-SPACE-04'
  // 剖面质量校验（模型端 sectionView.py）
  | 'R-QUAL-01'
  | 'R-QUAL-02'
  | 'R-QUAL-03'
  // 参数完整性（模型端 task_service.py / riskLevel.py）
  | 'R-PARAM-01'
  | 'R-PARAM-02';

/** 规则关联的可视化图层。同一图层的多条规则共用一个开关。 */
export type RuleLayer = 'river' | 'tiff';

export interface RuleDef {
  id: RuleId;
  category: RuleCategory;
  /** 树上的行名 */
  label: string;
  /** 判定依据（人话），用于 hover 与说明弹窗 */
  desc: string;
  /** 对应的后端失败码 / 报错文本特征 */
  failCode?: string;
  /** 默认是否启用。可关规则默认启用 = 与改动前行为一致，零迁移 */
  defaultOn: boolean;
  /**
   * 是否锁定（不可关闭）。
   *
   * <p>锁定的规则不是"还没做开关"，而是**给了开关就是假开关**：
   * 剖面质量类关掉不会算出结果，只会把 -9999 插值成假水深；
   * PL/LC 枚举关掉会退回"未填报按防护最强处理"。这些不开开关。
   */
  locked: boolean;
  /** 关联图层：规则行左侧的"眼睛"控制它 */
  layer?: RuleLayer;
  /** 停用后的后果提示（hover / 说明弹窗用） */
  offWarning?: string;
}
