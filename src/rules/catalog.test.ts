import { describe, expect, it } from 'vitest';
import {
  FAIL_CODE_RULE,
  RULE_CATALOG,
  RULE_CATEGORIES,
  SWITCHABLE_RULES,
  defaultRuleEnabled,
  disabledRuleIds,
  isMutedFailCode,
  isRuleOn,
  ruleById,
  rulesByCategory,
  rulesetKeyOf,
} from './catalog';

describe('rule catalog', () => {
  it('id 唯一且九个分类都有归属', () => {
    const ids = RULE_CATALOG.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(9);
    for (const cat of RULE_CATEGORIES) {
      expect(rulesByCategory(cat.key).length).toBeGreaterThan(0);
    }
    // 分类顺序即树上的顺序，必须与文档一致（空间 → 质量 → 参数）
    expect(RULE_CATEGORIES.map((c) => c.key)).toEqual(['space', 'quality', 'param']);
  });

  it('只有空间校验里的三条可关，其余锁定', () => {
    expect(SWITCHABLE_RULES.map((r) => r.id)).toEqual(['R-SPACE-01', 'R-SPACE-02', 'R-SPACE-04']);
    for (const id of ['R-SPACE-03', 'R-QUAL-01', 'R-QUAL-02', 'R-QUAL-03', 'R-PARAM-01', 'R-PARAM-02'] as const) {
      expect(ruleById(id)?.locked).toBe(true);
    }
  });

  it('锁定规则一律 defaultOn=true（锁定给一个默认关闭的开关毫无意义）', () => {
    for (const r of RULE_CATALOG) {
      if (r.locked) expect(r.defaultOn).toBe(true);
    }
  });

  it('默认启用表覆盖全部规则', () => {
    const map = defaultRuleEnabled();
    expect(Object.keys(map).sort()).toEqual(RULE_CATALOG.map((r) => r.id).sort());
  });

  it('缺 key 时回落到 defaultOn（老用户升级不会把规则全部停用）', () => {
    expect(isRuleOn({}, 'R-SPACE-01')).toBe(true);
    expect(isRuleOn(undefined, 'R-SPACE-04')).toBe(true);
    expect(isRuleOn({ 'R-SPACE-01': false }, 'R-SPACE-01')).toBe(false);
  });

  it('disabledRuleIds 只反映可关规则', () => {
    expect(disabledRuleIds(defaultRuleEnabled())).toEqual([]);
    const off = { ...defaultRuleEnabled(), 'R-SPACE-01': false };
    expect(disabledRuleIds(off)).toEqual(['R-SPACE-01']);
    // 锁定规则即使被人为写成 false 也不会进 disabled 列表（后端也不认）
    expect(disabledRuleIds({ ...defaultRuleEnabled(), 'R-QUAL-01': false })).toEqual([]);
  });

  it('rulesetKey 对任一可关规则的变化都敏感，对锁定规则不敏感', () => {
    const base = defaultRuleEnabled();
    expect(rulesetKeyOf({ ...base, 'R-QUAL-01': false })).toBe(rulesetKeyOf(base));
    for (const id of ['R-SPACE-01', 'R-SPACE-02', 'R-SPACE-04'] as const) {
      expect(rulesetKeyOf({ ...base, [id]: false })).not.toBe(rulesetKeyOf(base));
    }
  });

  it('可关规则必须写明停用后果（UI hover 与说明弹窗都读它）', () => {
    for (const r of SWITCHABLE_RULES) {
      expect(r.offWarning && r.offWarning.length > 5).toBe(true);
    }
  });

  it('只有「与长江河面相交」与「须位于 DEM 覆盖内」各自持有一个图层入口', () => {
    // R-SPACE-02 看的是同一份长江面几何，不再重复挂一个眼睛（两条规则共用一个边界）
    expect(RULE_CATALOG.filter((r) => r.layer === 'river').map((r) => r.id)).toEqual(['R-SPACE-01']);
    expect(RULE_CATALOG.filter((r) => r.layer === 'tiff').map((r) => r.id)).toEqual(['R-SPACE-04']);
  });
});

describe('isMutedFailCode（库里的旧结论是否由已停用规则产生）', () => {
  it('失败码映射到真实存在的规则', () => {
    for (const [code, id] of Object.entries(FAIL_CODE_RULE)) {
      expect(code).toBe(code.toLowerCase());
      expect(ruleById(id)).toBeTruthy();
    }
    expect(Object.keys(FAIL_CODE_RULE).sort()).toEqual([
      'invalid_inside_river',
      'invalid_no_river',
      'invalid_no_tiff',
      'invalid_out_of_tiff',
      'pending_tiff_bounds',
    ]);
  });

  it('规则开着时旧结论照常生效（不能用它偷偷放宽判定）', () => {
    const allOn = defaultRuleEnabled();
    expect(isMutedFailCode('invalid_no_river', allOn)).toBe(false);
    expect(isMutedFailCode('invalid_out_of_tiff', allOn)).toBe(false);
  });

  it('规则关掉后同一失败码判为"待重算"', () => {
    const enabled = { ...defaultRuleEnabled(), 'R-SPACE-01': false };
    expect(isMutedFailCode('invalid_no_river', enabled)).toBe(true);
    // 其余规则的失败码不受影响
    expect(isMutedFailCode('invalid_out_of_tiff', enabled)).toBe(false);
    expect(isMutedFailCode('invalid_inside_river', enabled)).toBe(false);
  });

  it('锁定规则（R-SPACE-03）永远不可被静音', () => {
    const enabled = { ...defaultRuleEnabled(), 'R-SPACE-03': false };
    expect(isMutedFailCode('invalid_no_tiff', enabled)).toBe(false);
    expect(isMutedFailCode('pending_tiff_bounds', enabled)).toBe(false);
  });

  it('无效 / 空 / 未知状态一律不静音', () => {
    const enabled = { ...defaultRuleEnabled(), 'R-SPACE-01': false };
    expect(isMutedFailCode('', enabled)).toBe(false);
    expect(isMutedFailCode(null, enabled)).toBe(false);
    expect(isMutedFailCode(undefined, enabled)).toBe(false);
    expect(isMutedFailCode('valid', enabled)).toBe(false);
    expect(isMutedFailCode('something_else', enabled)).toBe(false);
  });

  it('大小写与空白不敏感（后端可能回大写）', () => {
    const enabled = { ...defaultRuleEnabled(), 'R-SPACE-01': false };
    expect(isMutedFailCode(' INVALID_NO_RIVER ', enabled)).toBe(true);
  });
});
