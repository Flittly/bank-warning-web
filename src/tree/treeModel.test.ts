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
