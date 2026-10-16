import { describe, it, expect } from 'vitest';
import {
  buildLoadedGroups,
  buildLoadedView,
  DEFAULT_ROW_LIMIT,
  formatElapsed,
  isRunningStatus,
  parseServerTime,
  pickRunningTasks,
} from './loadedOnMap';
import type { LoadedGroup } from './loadedOnMap';

// —— 构造夹具 ——
const line = (props: Record<string, unknown>, type = 'LineString') => ({
  type: 'Feature' as const,
  geometry: { type, coordinates: [[119.9, 32.2], [119.91, 32.21]] } as any,
  properties: props,
});

/** 三组行数求和（断言用；面板侧由 `LoadedView.total` 承担） */
const rowCount = (groups: LoadedGroup[]) => groups.reduce((n, g) => n + g.rows.length, 0);

describe('已加载到屏幕 · 运行中任务判定', () => {
  it('只认 running，大小写与首尾空格都不影响', () => {
    expect(isRunningStatus('running')).toBe(true);
    expect(isRunningStatus(' RUNNING ')).toBe(true);
    expect(isRunningStatus('Running')).toBe(true);
    expect(isRunningStatus('completed')).toBe(false);
    expect(isRunningStatus('partial_failed')).toBe(false);
    expect(isRunningStatus(undefined)).toBe(false);
    expect(isRunningStatus(null)).toBe(false);
  });

  it('挑出运行中任务并归一字段；缺 id 的条目丢掉', () => {
    const rows = pickRunningTasks([
      { task_id: 't1', task_name: '岸线分析', status: 'running', run_started_at: '2026-10-15 17:01:40' },
      { task_id: 't2', task_name: '已完成任务', status: 'completed' },
      { task_name: '没有 id', status: 'running' },
      { id: 7, status: 'running' },
    ]);
    expect(rows.map((r) => r.taskId)).toEqual(['t1', '7']);
    expect(rows[0].taskName).toBe('岸线分析');
    // 没有名字时退回 id，绝不显示空白
    expect(rows[1].taskName).toBe('7');
    expect(rows[0].startedAt).toBe('2026-10-15 17:01:40');
    expect(rows[1].startedAt).toBeNull();
  });

  it('兼容 runStartedAt 驼峰字段', () => {
    const rows = pickRunningTasks([{ task_id: 't9', status: 'running', runStartedAt: '2026-10-15T09:00:00' }]);
    expect(rows[0].startedAt).toBe('2026-10-15T09:00:00');
  });

  it('空清单/undefined 不炸', () => {
    expect(pickRunningTasks(undefined)).toEqual([]);
    expect(pickRunningTasks([])).toEqual([]);
  });
});

describe('已加载到屏幕 · 时间解析与时长文案', () => {
  it('ISO、无时区串、秒/毫秒时间戳都能解析', () => {
    const local = new Date(2026, 9, 15, 17, 1, 40).getTime();
    // 无时区串（后端 LocalDateTime 的默认序列化形态）按本地时区解释
    expect(parseServerTime('2026-10-15 17:01:40')).toBe(local);
    expect(parseServerTime('2026-10-15T17:01:40')).toBe(local);
    expect(parseServerTime(1792042900)).toBe(1792042900 * 1000);
    expect(parseServerTime(1792042900000)).toBe(1792042900000);
  });

  it('解析不了的给 null，而不是 NaN', () => {
    expect(parseServerTime(null)).toBeNull();
    expect(parseServerTime('')).toBeNull();
    expect(parseServerTime('不是时间')).toBeNull();
  });

  it('时长分档：刚刚开始 / 秒 / 分秒 / 小时分', () => {
    expect(formatElapsed(0)).toBe('刚刚开始');
    expect(formatElapsed(4_000)).toBe('刚刚开始');
    expect(formatElapsed(30_000)).toBe('已运行 30 秒');
    expect(formatElapsed(90_000)).toBe('已运行 1 分 30 秒');
    expect(formatElapsed(3_600_000 + 5 * 60_000)).toBe('已运行 1 小时 5 分');
  });

  it('拿不到起点或负数时不产出文案', () => {
    expect(formatElapsed(null)).toBe('');
    expect(formatElapsed(-1)).toBe('');
  });
});

describe('已加载到屏幕 · 分组行模型', () => {
  it('全空时仍产出三组，且每组都带可执行的空态提示', () => {
    const groups = buildLoadedGroups({});
    expect(groups.map((g) => g.key)).toEqual(['banks', 'sections', 'dems']);
    expect(rowCount(groups)).toBe(0);
    for (const g of groups) {
      expect(g.rows).toEqual([]);
      expect(g.hint.length).toBeGreaterThan(0);
    }
  });

  it('岸段只认 LineString（与地图图层口径一致），按 bank_id 去重', () => {
    const groups = buildLoadedGroups({
      uploadedData: {
        type: 'FeatureCollection',
        features: [
          line({ bank_id: 'b1', bank_name: '南通岸段', region_code: 'Mzs' }),
          line({ bank_id: 'b1', bank_name: '南通岸段' }), // 重复
          line({ bank_id: 'b2' }),                       // 无名字 → 标签用 id
          line({ bank_id: 'b3', bank_name: '点要素' }, 'Point'), // 非线要素，地图不画
        ] as any,
      },
    });
    const banks = groups.find((g) => g.key === 'banks')!;
    expect(banks.rows.map((r) => r.id)).toEqual(['b1', 'b2']);
    expect(banks.rows[0].label).toBe('南通岸段');
    expect(banks.rows[0].meta).toBe('b1');
    // 标签就是 id 时改用区域代码，避免同一串字符出现两遍
    expect(banks.rows[1].label).toBe('b2');
    expect(banks.rows[1].meta).toBeUndefined();
  });

  it('岸段无名字且无区域代码时，兜底为「岸线 N」且不再重复 id', () => {
    const groups = buildLoadedGroups({
      uploadedData: { type: 'FeatureCollection', features: [line({})] } as any,
    });
    const row = groups.find((g) => g.key === 'banks')!.rows[0];
    expect(row.label).toBe('岸线 1');
    expect(row.meta).toBeUndefined();
  });

  it('断面用 section_name，缺失时回退「断面 N」；按 id 去重', () => {
    const groups = buildLoadedGroups({
      perpendicularData: {
        type: 'FeatureCollection',
        features: [
          line({ sectionId: 's1', section_name: '断面A', bank_id: 'b1' }),
          line({ sectionId: 's1', section_name: '断面A' }),
          line({ sectionId: 's2', crossLineId: 4, bank_id: 'b1' }),
        ] as any,
      },
    });
    const rows = groups.find((g) => g.key === 'sections')!.rows;
    expect(rows.map((r) => r.id)).toEqual(['s1', 's2']);
    expect(rows[0].label).toBe('断面A');
    expect(rows[0].meta).toBe('b1');
    expect(rows[1].label).toBe('断面 5');
  });

  it('任务切换：属于当前任务的断面被打「当前任务」标', () => {
    const perpendicularData = {
      type: 'FeatureCollection',
      features: [line({ sectionId: 's1' }), line({ sectionId: 's2' })],
    } as any;
    const sectionsByTask = { t1: [{ section_id: 's2' }] };

    const a = buildLoadedGroups({ perpendicularData, currentTaskId: 't1', sectionsByTask });
    expect(a.find((g) => g.key === 'sections')!.rows.map((r) => r.currentTask)).toEqual([false, true]);

    // 切到 t2：t2 的断面清单还没被懒加载 → 不打标（不猜），但行依旧列全
    const b = buildLoadedGroups({ perpendicularData, currentTaskId: 't2', sectionsByTask });
    expect(b.find((g) => g.key === 'sections')!.rows.map((r) => r.currentTask)).toEqual([false, false]);
    expect(b.find((g) => g.key === 'sections')!.rows).toHaveLength(2);
  });

  it('断面图层开关关闭时，断面仍列出但标记为未绘制', () => {
    const groups = buildLoadedGroups({
      perpendicularData: { type: 'FeatureCollection', features: [line({ sectionId: 's1' })] } as any,
      showCrossLines: false,
    });
    const rows = groups.find((g) => g.key === 'sections')!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].dimmed).toBe(true);

    const shown = buildLoadedGroups({
      perpendicularData: { type: 'FeatureCollection', features: [line({ sectionId: 's1' })] } as any,
      showCrossLines: true,
    });
    expect(shown.find((g) => g.key === 'sections')!.rows[0].dimmed).toBe(false);
  });

  it('DEM 范围按传入的可见清单列出，计数进入总数', () => {
    const groups = buildLoadedGroups({
      uploadedData: { type: 'FeatureCollection', features: [line({ bank_id: 'b1' })] } as any,
      demItems: [{ key: 'tiff/Yangtze/2018/standard/1998-2018/dem.tif', label: 'dem.tif' }],
    });
    const dems = groups.find((g) => g.key === 'dems')!;
    expect(dems.rows.map((r) => r.label)).toEqual(['dem.tif']);
    expect(dems.rows[0].meta).toBe('范围框');
    expect(rowCount(groups)).toBe(2);
  });
});

// ——————————————————————————————————————————————————————————————
// 分组视图：折叠 / 每组渲染上限
// ——————————————————————————————————————————————————————————————

const row = (id: string, label: string, meta?: string) => ({ id, label, ...(meta ? { meta } : {}) });

/** 造一份和真机接近的夹具：岸段多、断面中等、DEM 少 */
function fixture(): LoadedGroup[] {
  return [
    {
      key: 'banks',
      title: '岸段',
      hint: '地图上没有岸段：在资源树里双击岸段，或右键选「加载到地图」。',
      rows: Array.from({ length: 91 }, (_, i) => row(`bank-${i}`, `扬中岸段${i}`, `B-${String(i).padStart(3, '0')}`)),
    },
    {
      key: 'sections',
      title: '断面',
      hint: '地图上没有断面：在「断面」文件夹右键选「全部加载到地图」。',
      rows: [row('s1', '断面 1', 'B-001'), row('s2', '断面 2', 'B-002')],
    },
    {
      key: 'dems',
      title: 'DEM 范围',
      hint: '地图上未显示 DEM 范围：在资源树里点 DEM 的「显示范围」或它的范围图标。',
      rows: [],
    },
  ];
}

describe('已加载到屏幕 · 分组视图', () => {
  it('三组恒定都在、顺序固定，总数与各组条数自洽', () => {
    const v = buildLoadedView(fixture());
    expect(v.groups.map((g) => g.key)).toEqual(['banks', 'sections', 'dems']);
    expect(v.total).toBe(93);
    expect(v.groups.map((g) => g.total)).toEqual([91, 2, 0]);
  });

  it('折叠只影响渲染态，计数照常给出（收起后仍要看得见组里有多少条）', () => {
    const collapseAll = ['banks', 'sections', 'dems'];
    const v = buildLoadedView(fixture(), { collapsed: collapseAll });
    expect(v.groups.every((g) => g.collapsed)).toBe(true);
    expect(v.groups.map((g) => g.total)).toEqual([91, 2, 0]);
    expect(v.total).toBe(93);
  });

  it('空态只在"真没有"时给指路 hint，有内容时为 null', () => {
    const v = buildLoadedView(fixture());
    expect(v.groups.find((g) => g.key === 'dems')!.emptyKind).toBe('no-data');
    expect(v.groups.find((g) => g.key === 'sections')!.emptyKind).toBeNull();
    // hint 文案必须留着 —— 界面靠它告诉用户怎么把这一组填上
    expect(v.groups.find((g) => g.key === 'dems')!.hint.length).toBeGreaterThan(0);
    expect(v.groups.find((g) => g.key === 'dems')!.rows).toEqual([]);
  });

  it('每组默认截断到 60 条并报出未显示条数，expandKeys 可解除该组上限', () => {
    const capped = buildLoadedView(fixture());
    const banks = capped.groups.find((g) => g.key === 'banks')!;
    expect(DEFAULT_ROW_LIMIT).toBe(60);
    expect(banks.rows).toHaveLength(DEFAULT_ROW_LIMIT);
    expect(banks.total).toBe(91);
    expect(banks.hiddenByLimit).toBe(31);
    // 截断只影响渲染，总数仍是 91（头部计数不能跟着缩水）
    expect(capped.total).toBe(93);

    const all = buildLoadedView(fixture(), { expandKeys: ['banks'] });
    const banksAll = all.groups.find((g) => g.key === 'banks')!;
    expect(banksAll.rows).toHaveLength(91);
    expect(banksAll.hiddenByLimit).toBe(0);
    // 只解除指定组，别的组仍受上限约束（这里断面本来就没到上限）
    expect(all.groups.find((g) => g.key === 'sections')!.rows).toHaveLength(2);
  });

  it('limit=0 表示完全不限制', () => {
    const v = buildLoadedView(fixture(), { limit: 0 });
    expect(v.groups.find((g) => g.key === 'banks')!.rows).toHaveLength(91);
    expect(v.groups.find((g) => g.key === 'banks')!.hiddenByLimit).toBe(0);
  });

  it('空分组集合与 Set 形态的 collapsed 都不炸', () => {
    const empty = buildLoadedView([], {});
    expect(empty.total).toBe(0);
    expect(empty.groups).toEqual([]);

    const withSet = buildLoadedView(fixture(), { collapsed: new Set(['banks']) });
    expect(withSet.groups[0].collapsed).toBe(true);
    expect(withSet.groups[1].collapsed).toBe(false);
  });

  it('端到端起：从地图数据一路到分组视图', () => {
    const groups = buildLoadedGroups({
      uploadedData: {
        type: 'FeatureCollection',
        features: [line({ bank_id: 'b1', bank_name: '扬中岸段' }), line({ bank_id: 'b2', bank_name: '九江岸段' })],
      } as any,
      perpendicularData: { type: 'FeatureCollection', features: [line({ sectionId: 's1', section_name: '断面A', bank_id: 'b1' })] } as any,
    });
    const v = buildLoadedView(groups);
    expect(v.groups.map((g) => g.total)).toEqual([2, 1, 0]);
    expect(v.total).toBe(3);
    // 行的次要信息透传：岸段带 bank_id、断面带所属岸段
    expect(v.groups[0].rows.map((r) => `${r.label}/${r.meta}`)).toEqual(['扬中岸段/b1', '九江岸段/b2']);
    expect(v.groups[1].rows[0].meta).toBe('b1');
  });
});
