import type { RuleCategory, RuleDef, RuleId } from './types';

/**
 * 规则清单 —— **唯一真源**。
 *
 * <p>改一条规则只需要动这里（加在对应分类下、标好 `locked` 与 `layer`），
 * 树会自动长出来。后端只认 id（`disabled_rules` 里的字符串），不认识就忽略并打 warn，
 * 所以前端先行加规则不会让校验请求整体失败。
 *
 * <p>九条规则的清点依据见 `docs/规则节点设计方案-2026-10-20.md` 第 1 节。
 */
export const RULE_CATEGORIES: { key: RuleCategory; label: string; hint: string }[] = [
  { key: 'space', label: '断面空间校验', hint: '断面画在哪儿：与长江河面、DEM 覆盖范围的关系' },
  { key: 'quality', label: '剖面质量校验', hint: '数据够不够算：DEM 有效覆盖与剖面完整性' },
  { key: 'param', label: '参数完整性', hint: '参数填全、取值合法' },
];

export const RULE_CATALOG: RuleDef[] = [
  {
    id: 'R-SPACE-01',
    category: 'space',
    label: '与长江河面相交',
    desc: '断面必须与 river_yangtze 的长江面相交（ST_Intersects），否则无从判断岸坡与水位的相对位置。',
    failCode: 'invalid_no_river',
    defaultOn: true,
    locked: false,
    layer: 'river',
    offWarning: '停用后非长江断面也会通过校验，模型可能因缺少河面基准报错或算不出结果。',
  },
  {
    id: 'R-SPACE-02',
    category: 'space',
    label: '不得完全落在江面内',
    desc: '断面整条都在长江面内部（ST_Within）时不合法 —— 两端都泡在水里，取不到岸坡基准。',
    failCode: 'invalid_inside_river',
    defaultOn: true,
    locked: false,
    // 与 R-SPACE-01 共用长江面几何，不重复给「眼睛」：两条规则看的是同一个边界
    offWarning: '停用后两端都在水里的断面也能提交，通常会在剖面质量校验处因剖面退化被拦下。',
  },
  {
    id: 'R-SPACE-03',
    category: 'space',
    label: '必须指定基准 DEM',
    desc: '断面所属参数必须绑定 bench_id；没有基准 DEM 就没有可采样的高程面。',
    failCode: 'invalid_no_tiff / pending_tiff_bounds',
    defaultOn: true,
    locked: true,
  },
  {
    id: 'R-SPACE-04',
    category: 'space',
    label: '须位于 DEM 覆盖范围内',
    desc: '断面整体必须落在所选 DEM 的边界（tiff_bounds）内，否则采样点会落到栅格之外。',
    failCode: 'invalid_out_of_tiff',
    defaultOn: true,
    locked: false,
    layer: 'tiff',
    offWarning: '停用后越界断面也会通过，越界部分按 nodata 处理，通常会被 DEM 覆盖长度校验拦下。',
  },
  {
    id: 'R-QUAL-01',
    category: 'quality',
    label: 'DEM 有效覆盖长度',
    desc: '最长连续有效段长度须 ≥ min(100 m, 断面全长)；不足时剖面无法支撑坡度与最深点计算。',
    failCode: 'DEM_COVERAGE_INSUFFICIENT',
    defaultOn: true,
    locked: true,
  },
  {
    id: 'R-QUAL-02',
    category: 'quality',
    label: '剖面不得退化',
    desc: '裁剪后最深点索引必须 > 0（不能就落在起点），否则单侧坡面为空、Sa_v 无定义。',
    failCode: 'SECTION_PROFILE_DEGENERATE',
    defaultOn: true,
    locked: true,
  },
  {
    id: 'R-QUAL-03',
    category: 'quality',
    label: '垂向剖面非空',
    desc: '有效点组成的垂向剖面（Sa_v）不能为空，否则无法计算断面形态指标。',
    failCode: 'SECTION_VERTICAL_PROFILE_EMPTY',
    defaultOn: true,
    locked: true,
  },
  {
    id: 'R-PARAM-01',
    category: 'param',
    label: '必填参数非空',
    desc: 'hs / hc / 防护等级 / 扰动等级 / 流量 / 潮位 / 基准与对照 DEM / 两个时相，缺一个模型都拒绝执行。',
    failCode: 'missing required fields',
    defaultOn: true,
    locked: true,
  },
  {
    id: 'R-PARAM-02',
    category: 'param',
    label: '防护等级 / 土地类别合法',
    desc: 'PL / LC 必须是合法枚举；非法值兜底到 1 档等于把"未填报"当成"防护最强"。',
    failCode: 'ValueError (protection-level / control-level)',
    defaultOn: true,
    locked: true,
  },
];

const BY_ID = new Map<RuleId, RuleDef>(RULE_CATALOG.map((r) => [r.id, r]));

export const ruleById = (id: RuleId): RuleDef | undefined => BY_ID.get(id);

/** 可开关的规则（locked=false） */
export const SWITCHABLE_RULES = RULE_CATALOG.filter((r) => !r.locked);

/** 默认启用表：只包含可关规则也没关系，locked 的恒为 true 且不可改 */
export function defaultRuleEnabled(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const r of RULE_CATALOG) out[r.id] = r.defaultOn;
  return out;
}

/**
 * 读某条规则是否启用。
 *
 * <p>持久化数据里缺少该 key（新增规则后老用户升级）时回落 `defaultOn`，
 * 避免"升级后被静默全部停用"。
 */
export function isRuleOn(enabled: Record<string, boolean> | undefined, id: RuleId): boolean {
  const v = enabled?.[id];
  if (typeof v === 'boolean') return v;
  return ruleById(id)?.defaultOn ?? true;
}

/** 当前**被停用**的可关规则 id 列表（发给后端 `disabled_rules`） */
export function disabledRuleIds(enabled: Record<string, boolean> | undefined): RuleId[] {
  return SWITCHABLE_RULES.filter((r) => !isRuleOn(enabled, r.id)).map((r) => r.id);
}

/**
 * 规则集指纹：任一可关规则的开关变化都会改变它。
 *
 * <p>用于"规则变了 → 历史校验结论作废"的判定。只包含可关规则 ——
 * locked 规则恒为启用，把常量掺进来只会让指纹无意义地变长。
 */
export function rulesetKeyOf(enabled: Record<string, boolean> | undefined): string {
  return SWITCHABLE_RULES.map((r) => `${r.id}=${isRuleOn(enabled, r.id) ? 1 : 0}`).join('|');
}

/** 分组：按分类返回规则（保持 catalog 中的顺序） */
export function rulesByCategory(category: RuleCategory): RuleDef[] {
  return RULE_CATALOG.filter((r) => r.category === category);
}

/**
 * 失败码 → 产出它的规则。
 *
 * <p>{@link RuleDef.failCode} 是写给人看的（会写成“A / B”这种并列），**不能**拿来做精确匹配；
 * 这张表才是程序用的那一份。键一律小写，比较前先归一。
 */
export const FAIL_CODE_RULE: Record<string, RuleId> = {
  invalid_no_river: 'R-SPACE-01',
  invalid_inside_river: 'R-SPACE-02',
  invalid_no_tiff: 'R-SPACE-03',
  pending_tiff_bounds: 'R-SPACE-03',
  invalid_out_of_tiff: 'R-SPACE-04',
};

/**
 * 库里存的这条「不通过」结论，是不是由一条**现在已经停用**的规则算出来的。
 *
 * <p>为什么需要它：`cross_sections.validation_status` 只记录“最后一次判定的结果”，
 * 不带规则集指纹。用户关掉某条规则后刷新页面，地图照着库里的旧结论把断面标红，
 * 可实际上重新校验就会变绿 —— 看起来就像“规则根本没关掉”。
 *
 * <p>这属于纯展示口径修正：不清库、不放宽任何判定。真到分析前，
 * `validateAllSectionsBeforeAnalysis` 仍会按当前规则集重算一遍。
 */
export function isMutedFailCode(
  rawStatus: string | null | undefined,
  enabled?: Record<string, boolean>,
): boolean {
  if (!rawStatus) return false;
  const ruleId = FAIL_CODE_RULE[String(rawStatus).trim().toLowerCase()];
  if (!ruleId) return false;
  // 锁定规则永远不能被静音：store 的 setEnabled 会拒绝写它，但 localStorage 是可以手改的，
  // 所以这里再按目录兜一层 —— 否则一条"理论上不可关"的规则能靠改存储绕过。
  const def = ruleById(ruleId);
  if (!def || def.locked) return false;
  return !isRuleOn(enabled, ruleId);
}
