/**
 * DEM 三维地形：开关、切片触发、状态轮询。
 *
 * <p>编辑器与结果页共用这一套 —— 两边唯一的差别是**数据从哪来**：编辑器跟「当前预览的
 * 那份 DEM」走，结果页跟「当前选中任务的 DEM」走。真正贴着地图的那层（`raster-dem` 源、
 * 夸张系数、光照、山体阴影、中键轨道）在 `map/terrainLayer.ts` 与 `map/middleDragTilt.ts`，
 * 这里只管「什么时候能挂、挂了之后状态怎么显示」，所以两处的手感必然一致。
 *
 * <h3>为什么必须轮询</h3>
 * 切片是模型服务后台异步做的（几秒到几分钟）。打开三维时若还没切好，就每 3 秒问一次；
 * `POST /terrain/build` 是**幂等**的（已就绪且未过期时什么都不做），所以轮询期间反复调用它
 * 是安全的 —— 顺便让后端替我们做过期检查，源 DEM 换了就会重新切。
 *
 * <h3>换 DEM 的两条策略</h3>
 * `follow` 决定 DEM 变了但开关还开着时怎么办：
 * <ul>
 *   <li>`true`（结果页）：直接为新的 DEM 重新切片并接着展示 —— 用户切任务时不该被关掉三维；</li>
 *   <li>`false`（编辑器，默认）：收掉地形。编辑器的 DEM 是双击铺上去的，换一份意味着换了
 *       研究区域，保留视角和夸张系数反而容易把两份 DEM 记混。</li>
 * </ul>
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import {
  DEFAULT_TERRAIN_EXAGGERATION,
  terrainStatusView,
  type DemTerrainSpec,
  type TerrainStatusView,
} from '../map/terrainLayer';
import {
  requestDemTerrainBuild,
  terrainSpecOf,
  type DemTerrainInfo,
} from '../services/demTerrainService';

/** 切片是后台异步的，打开开关后按这个间隔问一次进度 */
const TERRAIN_POLL_INTERVAL_MS = 3000;
/**
 * 轮询上限。实测 1 万×3 千、30 m 的 DEM 切 8–12 级只要 10 秒；留到 10 分钟是为了
 * 给更大的 DEM 和排队（单线程 worker，前面可能还压着别的任务）留余量。
 */
const TERRAIN_POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** 到这些状态就停止轮询：要么能用了，要么再问也不会变 */
const TERMINAL_TERRAIN_STATUSES: ReadonlySet<DemTerrainInfo['status']> = new Set([
  'ready',
  'failed',
  'missing',
  'unavailable',
]);

/** 后端判定「DEM 不存在」时前端手搓的最小状态体（这种情况下后端只回 404，没有正文） */
const EMPTY_TERRAIN_INFO: DemTerrainInfo = {
  tiff_key: '',
  status: 'none',
  fingerprint: null,
  minzoom: null,
  maxzoom: null,
  bounds: null,
  tile_count: null,
  error: null,
  generated_at: null,
};

/** 可中止的等待：用户关掉开关 / 换 DEM 时立刻醒，不留一个 3 秒后的野请求 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}

function errorMessage(error: unknown, fallback: string): string {
  const text = (error as { message?: unknown } | null)?.message;
  return typeof text === 'string' && text ? text : fallback;
}

export interface UseDemTerrainOptions {
  /** 要展示的 DEM（tiff_key）。空串 / null 表示当前没有可用的 DEM。 */
  tiffKey: string | null | undefined;
  /** DEM 变了但开关还开着时，是否自动为新 DEM 重新切片（见文件头「换 DEM 的两条策略」） */
  follow?: boolean;
}

export interface DemTerrainController {
  /** 开关是否打开（决定是否往地图上挂地形） */
  on: boolean;
  /** 后端返回的完整状态；未开始 / 已收掉时为 null */
  info: DemTerrainInfo | null;
  /** 能直接交给 `applyTerrain` 的描述；没就绪时为 null */
  spec: DemTerrainSpec | null;
  /** 面板上那一行状态文案 */
  view: TerrainStatusView | null;
  exaggeration: number;
  setExaggeration: (value: number) => void;
  toggle: (next: boolean) => void;
  /** 失败后点「重试」：状态回到 pending 并重新跑一遍 */
  restart: () => void;
  /** 收掉地形并清空状态（换 DEM / 卸载时用） */
  reset: () => void;
}

export function useDemTerrain({ tiffKey, follow = false }: UseDemTerrainOptions): DemTerrainController {
  const [on, setOn] = useState(false);
  const [info, setInfo] = useState<DemTerrainInfo | null>(null);
  const [exaggeration, setExaggeration] = useState(DEFAULT_TERRAIN_EXAGGERATION);
  const abortRef = useRef<AbortController | null>(null);

  const key = (tiffKey ?? '').trim();
  // 轮询 / 重试都在回调里跑，不能靠闭包捕获 key（回调只建一次）
  const keyRef = useRef(key);
  keyRef.current = key;
  const followRef = useRef(follow);
  followRef.current = follow;

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const run = useCallback(async (target: string) => {
    stop();
    const controller = new AbortController();
    abortRef.current = controller;
    const deadline = Date.now() + TERRAIN_POLL_TIMEOUT_MS;
    try {
      while (!controller.signal.aborted) {
        const next = await requestDemTerrainBuild(target, controller.signal);
        if (controller.signal.aborted) return;
        setInfo(next);
        if (TERMINAL_TERRAIN_STATUSES.has(next.status)) return;
        if (Date.now() >= deadline) {
          message.warning('三维地形生成超时，请稍后重新打开');
          setOn(false);
          return;
        }
        await sleep(TERRAIN_POLL_INTERVAL_MS, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      // 404 = 后端判定这份 DEM 不存在或无权访问（IllegalArgumentException 统一映射 404）。
      // follow 模式下保留开关：页面会把「DEM 不存在或无权访问 + 重试」显示在面板上，
      // 关掉开关反而把唯一的原因藏了起来（按钮弹回去 = 用户眼里的「点了没反应」）。
      if (/HTTP 404/.test(errorMessage(error, ''))) {
        setInfo({ ...EMPTY_TERRAIN_INFO, tiff_key: target, status: 'missing' });
        if (!followRef.current) setOn(false);
        return;
      }
      setOn(false);
      message.error(errorMessage(error, '三维地形生成失败'));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setOn(false);
    setInfo(null);
  }, [stop]);

  const toggle = useCallback((next: boolean) => {
    setOn(next);
    if (!next) {
      stop();
      return;
    }
    if (keyRef.current) void run(keyRef.current);
  }, [run, stop]);

  const restart = useCallback(() => {
    const target = keyRef.current;
    if (!target) return;
    setInfo({ ...EMPTY_TERRAIN_INFO, tiff_key: target, status: 'pending' });
    setOn(true);
    void run(target);
  }, [run]);

  /** 记住上一份 DEM：只有**真的换了**才动状态，首次渲染和开关切换都不算 */
  const prevKeyRef = useRef(key);
  useEffect(() => {
    if (prevKeyRef.current === key) return;
    prevKeyRef.current = key;
    if (!on) {
      // 没开三维：只需要把旧 DEM 的状态扔掉，免得下次打开时先闪一下上一份的进度
      if (info) setInfo(null);
      return;
    }
    if (!key) {
      // 没有 DEM 时两种策略也不一样：
      //  * follow（结果页）：**保留开关**，让页面把「这个任务没有关联 DEM」说出来。
      //    悄悄关掉开关的话用户只会看到按钮自己弹回去，跟「点了没反应」没区别。
      //  * 不 follow（编辑器）：直接收掉 —— 那边没有 DEM 预览就没有三维可言。
      if (follow) {
        stop();
        setInfo(null);
        return;
      }
      reset();
      return;
    }
    if (follow) {
      // 旧 DEM 的信息立刻失效（`spec` 里带 tiff_key 校验），新的从头问一遍
      setInfo(null);
      void run(key);
      return;
    }
    reset();
    // info 只用来判断「要不要清」，放进依赖会让清空后再触发一轮，故忽略
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on, follow, run, reset]);

  // 卸载时掐掉轮询：不然组件没了还在打请求，setState 会污染已卸载的树
  useEffect(() => () => stop(), [stop]);

  // 状态必须是**这份 DEM 的**：换 DEM 后后端可能还没回新值，这时候挂旧 spec 会把
  // 上一份的瓦片挂到新区域上（applyTerrain 里靠指纹能重建，但区域是错的）
  const spec = useMemo(
    () => (on && key && info?.tiff_key === key ? terrainSpecOf(info) : null),
    [on, key, info],
  );
  const view = on ? terrainStatusView(info?.status, info?.error) : null;

  return { on, info, spec, view, exaggeration, setExaggeration, toggle, restart, reset };
}
