import type { Map as MapboxMap } from 'mapbox-gl';

/**
 * 关掉 mapbox-gl v3 的 access token 自检。
 *
 * <p><b>为什么必须关</b>：v3 在「首帧渲染完成、地图刚进入 idle」时会调一次私有方法
 * `_authenticate()`，向 Mapbox 校验 access token。本项目从不使用 Mapbox 的样式或瓦片
 * （底图要么直连天地图，要么是本地离线瓦片），也不配 `VITE_MAPBOX_TOKEN`，于是校验
 * 立刻失败，而失败分支里它会：
 *
 * ```js
 * storeAuthState(gl, false);
 * gl.clear(DEPTH_BUFFER_BIT | COLOR_BUFFER_BIT | STENCIL_BUFFER_BIT);  // ← 清空整块画布
 * ```
 *
 * <p>因为这一步发生在**首帧之后、地图已 idle**，画面上就是「底图闪一下、随后连岸线
 * 和断面一起变成全白」，而且没有后续重绘把它画回来 —— 与瓦片、样式、CORS 全都无关，
 * 极难从现象反推。控制台只会留一句
 * `A valid Mapbox access token is required to use Mapbox GL JS.`。
 *
 * <p>这个校验对自建部署没有任何功能意义，它只做两件事：校验 token、上报 usage 数据。
 * 两件都不需要，直接换成空操作。
 *
 * <p>⚠ 依赖私有方法名（v3.19 实测存在）。升级 mapbox-gl 后若再次出现「首帧后整片变白」，
 * 先 grep 报错文案 `A valid Mapbox access token`，确认调用点是否改成了别的私有方法。
 */
export function disableMapboxAuthCheck(map: MapboxMap): void {
  const target = map as unknown as { _authenticate?: () => void };
  if (typeof target._authenticate === 'function') {
    target._authenticate = () => {};
  }
}
