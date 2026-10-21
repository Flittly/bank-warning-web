import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RuleId } from '../rules/types';
import { defaultRuleEnabled, isRuleOn, ruleById, rulesetKeyOf } from '../rules/catalog';

/**
 * 校验规则的启用状态。
 *
 * <p><b>为什么不并进 `useEditorStore`：</b>那个 store 的 `persist.partialize` 正在逐字段列白名单，
 * 且 `merge` 里要处理 Set 反序列化；规则配置有自己的生命周期（"这条判定要不要执行"），
 * 与视图状态（缩放、选中、图层）没有关系，混在一起只会让两边都更难改。
 *
 * <p><b>为什么存前端而不建后端表：</b>本系统是单机桌面形态（Electron + 本地后端 + admin 单用户），
 * 后端存一份只会带来"多浏览器不一致"和一张永远只有一行的空表。
 * 校验请求会带上 `disabled_rules`，将来若真要多端一致，把这里换成远程配置即可，接口契约不变。
 */
interface RuleState {
  /** 只存可关规则的开关；locked 规则不写入（写了也没有地方能改） */
  enabled: Record<string, boolean>;
  /** 切一条规则。锁定规则直接忽略 —— 调用方本不该给出入口，这里再兜一层 */
  setEnabled: (id: RuleId, on: boolean) => void;
  toggle: (id: RuleId) => void;
  /** 恢复默认（全部可关规则回到 defaultOn），排查"是不是我关了哪条"时用 */
  resetAll: () => void;
}

export const useRuleStore = create<RuleState>()(
  persist(
    (set, get) => ({
      enabled: defaultRuleEnabled(),

      setEnabled: (id, on) => {
        if (ruleById(id)?.locked) return;
        set((s) => ({ enabled: { ...s.enabled, [id]: on } }));
      },

      toggle: (id) => {
        if (ruleById(id)?.locked) return;
        const cur = isRuleOn(get().enabled, id);
        set((s) => ({ enabled: { ...s.enabled, [id]: !cur } }));
      },

      resetAll: () => set({ enabled: defaultRuleEnabled() }),
    }),
    {
      name: 'rule-storage',
      partialize: (s) => ({ enabled: s.enabled }),
      // 老用户持久化数据里没有新规则的 key：先用默认表铺底，再盖上传下来的值。
      // 直接 `{...current, ...p}` 会让新增规则从 enabled 里消失（虽然 isRuleOn 有兜底，
      // 但"打开开关后 enabled 里才有它"会让调试时看到的表莫名其妙缺字段）。
      merge: (persisted, current) => {
        const p = persisted as { enabled?: Record<string, boolean> } | undefined;
        return { ...current, enabled: { ...defaultRuleEnabled(), ...(p?.enabled || {}) } };
      },
    },
  ),
);

/** 当前规则集指纹（用于判断"规则变了 → 历史校验结论作废"） */
export const currentRulesetKey = (): string => rulesetKeyOf(useRuleStore.getState().enabled);
