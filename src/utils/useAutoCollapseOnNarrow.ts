import { useEffect } from 'react';

/**
 * 窄屏自动收起右侧 AI 面板。
 *
 * 为什么需要：三栏工作区是「350px 侧栏 + 弹性地图 + 350px 聊天」，
 * 两个固定宽度加起来 700px，视口一旦窄于 700，地图这块 `flex:1` 就被挤到 **0 宽**
 * —— 不报错、不降级，就是地图整块消失（实测 430px 视口下 `.mapboxgl-map` 量到 w:0）。
 *
 * 这里只做**单向**收缩：进入窄屏时收起，用户仍可手动点「AI」再展开；
 * 放宽视口时**不**自动展开，避免和用户当前选择打架。
 */
export function useAutoCollapseOnNarrow(
  setCollapsed: (value: boolean) => void,
  breakpoint = 900,
): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const apply = (matches: boolean) => {
      if (matches) setCollapsed(true);
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setCollapsed, breakpoint]);
}
