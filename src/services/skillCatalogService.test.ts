import { describe, expect, it } from 'vitest';
import { SKILL_SOURCE_META, approvalLabelOf, normalizeSkills } from './skillCatalogService';

describe('skillCatalogService', () => {
  it('skills 不是数组时返回空表', () => {
    expect(normalizeSkills(undefined)).toEqual([]);
    expect(normalizeSkills({ success: true })).toEqual([]);
    expect(normalizeSkills({ skills: { name: 'x' } })).toEqual([]);
  });

  it('保留来源与审批状态，未知来源归到 nacos', () => {
    const list = normalizeSkills({
      success: true,
      skills: [
        { name: 'a', source: 'local', version: '1.0.0', description: '本地技能', approval: 'PENDING' },
        { name: 'b', source: 'synced' },
        { name: 'c' },
        { name: '' },
      ],
    });
    expect(list.map((item) => [item.name, item.source, item.version])).toEqual([
      ['a', 'local', '1.0.0'],
      ['b', 'synced', ''],
      ['c', 'nacos', ''],
    ]);
    expect(list[0].approval).toBe('PENDING');
  });

  it('审批状态文案只认已知值', () => {
    expect(approvalLabelOf('APPROVED')).toBe('已批准');
    expect(approvalLabelOf('PENDING')).toBe('待审批');
    expect(approvalLabelOf('REJECTED')).toBe('已驳回');
    expect(approvalLabelOf('')).toBeNull();
    expect(approvalLabelOf('WHATEVER')).toBeNull();
  });

  it('三种来源都有中文标签与色调', () => {
    expect(SKILL_SOURCE_META.local.tone).toBe('info');
    expect(SKILL_SOURCE_META.synced.tone).toBe('success');
    expect(SKILL_SOURCE_META.nacos.label).toBe('Nacos');
  });
});
