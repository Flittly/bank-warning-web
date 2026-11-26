import type { ThemeConfig } from 'antd';

/**
 * antd 主题与我们的设计令牌对齐（唯一来源）。
 *
 * 为什么必须有这一层：`src/styles/tokens.css` 里的 `--ds-primary` 是 #3b82f6，
 * 而 antd 在没有根级 ConfigProvider 时用的是默认 `#1677ff` —— 同一个页面里
 * `.ds-button--primary` 和 `.ant-btn-primary` 是两个蓝，同一排按钮悬停还一个变深一个变亮。
 *
 * ⚠ token 里不能写 `var(--ds-*)`：antd 的 token 会参与 JS 侧测量（控件高度、文字宽度），
 *   CSS 变量在那条链路上解析不了。所以这里写**字面量**，取值与 tokens.css 一一对应；
 *   改令牌时必须同步改这里，两边不一致会直接表现为"某个组件的圆角/颜色对不上"。
 *
 * ⚠ 不设 `zIndexPopupBase`（保持 1000）：设成 2000 会把 antd 的 Modal/Dropdown/Tooltip
 *   抬到自研 `.overlay`（`--ds-z-modal` = 1000）之上，自研弹窗会被 antd 下拉压住。
 *   toast 的 2010 由 `.ant-message` 那条 CSS 保证，见 design-system.css。
 */
export const antdTheme: ThemeConfig = {
  token: {
    // ---- 主色（变深方向与 .ds-button--primary 一致）----
    colorPrimary: '#3b82f6',
    colorPrimaryHover: '#2563eb',
    colorPrimaryActive: '#1d4ed8',
    colorInfo: '#3b82f6',
    colorLink: '#2563eb',
    colorLinkHover: '#1d4ed8',

    // ---- 语义色（与 riskScoring / ds-badge 同源，避免三套绿、三套红）----
    colorSuccess: '#0f9d70',
    colorWarning: '#b45309',
    colorError: '#dc2626',

    // ---- 文字与描边（中性色是冷灰 slate，不是 antd 的 rgba 黑）----
    colorText: '#1e293b',
    colorTextSecondary: '#475569',
    colorTextTertiary: '#64748b',
    colorTextQuaternary: '#94a3b8',
    colorBorder: '#cbd5e1', // = --ds-border-strong，与 .ds-input 同档
    colorBorderSecondary: '#e2e8f0', // = --ds-border
    colorSplit: '#e2e8f0',

    // ---- 底色 ----
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#eef1f6', // = --ds-canvas

    // ---- 字体（字面量，不能用 var()）----
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    fontFamilyCode: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    // lineHeight 有意不设：设成 1.65 会让所有表格行高 +1px、表单项变松，
    // 而正文排版本来就归 .ds-prose 管。

    // ---- 圆角（与 --ds-radius-* 对齐；设了它，`.ant-btn{border-radius}` 那条硬压可以删）----
    borderRadiusXS: 4,
    borderRadiusSM: 6,
    borderRadius: 10,
    borderRadiusLG: 14,

    // ---- 控件高度（.ds-button 是 36，antd 默认 32，同排会错位 4px）----
    controlHeight: 36,
    controlHeightSM: 30,
    controlHeightLG: 44,
  },
};
