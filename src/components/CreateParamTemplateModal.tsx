import { useEffect, useMemo, useRef, useState } from 'react';
import type { SectionParams } from '../types/sections';
import TiffResourcePicker from './TiffResourcePicker';
import styles from './Modal.module.css';
import { fetchBasicParamDetailAsSectionParams } from '../pages/editor/basicParamsApi';
import { commitJsonDraft, createJsonDraft, formatJsonDraft, updateJsonDraft } from '../utils/jsonDraft';

const TIDE_LABELS: Record<string, string> = { xc: '小潮', zc: '中潮', dc: '大潮' };

const formatHydroLabel = (waterQs: string, tidalLevel: string) => {
  const flow = waterQs ? `${waterQs} m³/s` : '未设流量';
  const tide = TIDE_LABELS[tidalLevel] || tidalLevel || '未设潮位';
  return `${flow} · ${tide}`;
};

/**
 * 空白模板的默认阈值 / 权重。
 * 口径与后端 `ensureDefaultBasicParams` 建的那份默认模板一致（同一套 8 项阈值 + 4 组权重），
 * 这样新建出来的模板不填任何东西也是「能直接算出四个等级」的完整模板，
 * 而不是一份缺少风险阈值、跑起来会掉进 KeyError 的空壳。
 */
const DEFAULT_RISK_THRESHOLDS: Record<string, number[]> = {
  Ky: [1.7, 1.35, 1],
  Ln: [0.04, 0.12, 0.2],
  PQ: [0.5, 1, 2.3],
  Sa: [0.2, 0.3, 0.5],
  Zb: [20, 30, 40],
  Zd: [0.1, 0.15, 0.3],
  all: [0.25, 0.5, 0.75],
  Dsed: [0.7, 1, 1.5],
};

const DEFAULT_WEIGHTS: Record<string, number[]> = {
  wGE: [0.6, 0.2, 0.2],
  wNM: [0.43, 0.32, 0.25],
  wRE: [0.48, 0.16, 0.36],
  wRL: [0.32, 0.43, 0.25],
};

/** 送往后端 `POST /v0/bank/basic-params` 的一条 params 元素（字段名对齐 BasicParamPayload） */
export interface CreateParamTemplateForm {
  param_id: string;
  param_name: string;
  segment: string;
  set_name: string;
  water_qs: string;
  tidal_level: string;
  current_timepoint: string;
  comparison_timepoint: string;
  bench_id: string;
  ref_id: string;
  hs: number;
  hc: number;
  protection_level: string;
  control_level: string;
  risk_thresholds: Record<string, unknown>;
  weights: Record<string, unknown>;
  other_params: Record<string, unknown>;
}

export interface ParamTemplateOption {
  param_id: string;
  param_name: string;
}

interface Props {
  /** 已有模板，用于「复制自」下拉和 param_id 唯一性校验 */
  templates: ParamTemplateOption[];
  /** 默认河段（一般取当前平台默认数据域，即 Yangtze） */
  defaultSegment?: string;
  onSubmit: (form: CreateParamTemplateForm, openAfter: boolean) => Promise<void>;
  onCancel: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 生成一个「可读 + 几乎不可能撞车」的 param_id。
 *
 * 注意 `basic_params.param_id` 在库里是**全库唯一**（`basic_params_param_id_key`），
 * 不是按 user 唯一 —— 所以不能只跟当前用户看得见的列表比对，
 * 必须自带足够的随机性。名字里若含 ASCII 就借它做可读前缀，否则退回通用前缀。
 */
function buildParamId(name: string, existing: Set<string>): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const ascii = (name || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  const base = ascii ? `PARAM_${ascii}` : 'PARAM_TEMPLATE';
  if (!existing.has(base)) return `${base}_${stamp}`;
  let i = 2;
  while (existing.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}_${stamp}`;
}

export default function CreateParamTemplateModal({
  templates,
  defaultSegment = 'Yangtze',
  onSubmit,
  onCancel,
}: Props) {
  const [paramName, setParamName] = useState('');
  const [paramId, setParamId] = useState('');
  const [paramIdTouched, setParamIdTouched] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [openAfter, setOpenAfter] = useState(true);

  const [segment, setSegment] = useState(defaultSegment);
  const [setName, setSetName] = useState('standard');
  const [hydroValue, setHydroValue] = useState('');
  const [currentTimepoint, setCurrentTimepoint] = useState('202304');
  const [comparisonTimepoint, setComparisonTimepoint] = useState('201904');
  const [benchId, setBenchId] = useState('');
  const [refId, setRefId] = useState('');
  const [hs, setHs] = useState<number>(0.5);
  const [hc, setHc] = useState<number>(2);
  const [protectionLevel, setProtectionLevel] = useState('systemic');
  const [controlLevel, setControlLevel] = useState('strict');
  /**
   * 阈值 / 权重用「草稿」保存用户正在编辑的原始文本，而不是把它 parse 进 state 再 stringify 回去。
   * 后者的后果是：任何非法中间态都会被静默丢弃、光标跳到末尾，表现为这两个 JSON 框完全改不动。
   * 详见 utils/jsonDraft.ts。
   */
  const [riskDraft, setRiskDraft] = useState(() => createJsonDraft(DEFAULT_RISK_THRESHOLDS));
  const [weightsDraft, setWeightsDraft] = useState(() => createJsonDraft(DEFAULT_WEIGHTS));
  const [otherParams, setOtherParams] = useState<Record<string, unknown>>({});

  const [hydroOptions, setHydroOptions] = useState<Array<{ water_qs: string; tidal_level: string }>>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);

  const existingIds = useMemo(
    () => new Set(templates.map((t) => String(t.param_id || '')).filter(Boolean)),
    [templates],
  );

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // 水文条件选项：与「断面参数」弹窗用同一个接口，保证两处口径一致
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/v0/bank/hydro-conditions');
        const data = await res.json();
        if (cancelled || !Array.isArray(data?.conditions)) return;
        const conditions = data.conditions as Array<{ water_qs: string; tidal_level: string }>;
        setHydroOptions(conditions);
        // 后端已把下拉收口到只剩一项（84000 m³/s · 1998-2023）。只剩一项时直接预选，
        // 免得新建模板要为一个"没得选"的下拉多点一次；用户已经选过（含「复制模板」带过来的值）就不覆盖。
        if (conditions.length === 1) {
          const only = conditions[0];
          setHydroValue((prev) => prev || `${only.water_qs}|${only.tidal_level}`);
        }
      } catch (err) {
        console.error('获取水文条件失败:', err);
        if (!cancelled) setHydroOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // param_id 自动跟随名称，除非用户手动改过 —— 手动改过就不再覆盖，避免"打一半被顶掉"
  useEffect(() => {
    if (paramIdTouched) return;
    setParamId(paramName.trim() ? buildParamId(paramName, existingIds) : '');
  }, [paramName, paramIdTouched, existingIds]);

  const applySectionParams = (sp: SectionParams) => {
    if (sp.param_name != null) setParamName(String(sp.param_name));
    if (sp.segment != null) setSegment(String(sp.segment));
    if (sp.set_name != null) setSetName(String(sp.set_name));
    if (sp.water_qs || sp.tidal_level) setHydroValue(`${sp.water_qs || ''}|${sp.tidal_level || ''}`);
    if (sp.current_timepoint != null) setCurrentTimepoint(String(sp.current_timepoint));
    if (sp.comparison_timepoint != null) setComparisonTimepoint(String(sp.comparison_timepoint));
    setBenchId(sp.bench_id || '');
    setRefId(sp.ref_id || '');
    if (sp.hs != null) setHs(Number(sp.hs));
    if (sp.hc != null) setHc(Number(sp.hc));
    if (sp.protection_level != null) setProtectionLevel(String(sp.protection_level));
    if (sp.control_level != null) setControlLevel(String(sp.control_level));
    if (sp.risk_thresholds && Object.keys(sp.risk_thresholds).length > 0) {
      setRiskDraft(createJsonDraft(sp.risk_thresholds));
    }
    if (sp.weights && Object.keys(sp.weights).length > 0) {
      setWeightsDraft(createJsonDraft(sp.weights));
    }
    if (sp.other_params && typeof sp.other_params === 'object') {
      // 复制时必须摘掉 is_default —— 否则会凭空多出一个"默认"模板
      const next = { ...(sp.other_params as Record<string, unknown>) };
      delete next.is_default;
      setOtherParams(next);
    }
  };

  const handleCopyFrom = async (pid: string) => {
    setCopyFrom(pid);
    setError('');
    if (!pid) {
      // 切回「空白模板」：还原出厂默认值
      setSegment(defaultSegment);
      setSetName('standard');
      setHydroValue('');
      setCurrentTimepoint('202304');
      setComparisonTimepoint('201904');
      setBenchId('');
      setRefId('');
      setHs(0.5);
      setHc(2);
      setProtectionLevel('systemic');
      setControlLevel('strict');
      setRiskDraft(createJsonDraft(DEFAULT_RISK_THRESHOLDS));
      setWeightsDraft(createJsonDraft(DEFAULT_WEIGHTS));
      setOtherParams({});
      return;
    }
    setCopyLoading(true);
    try {
      const { sectionParams } = await fetchBasicParamDetailAsSectionParams(pid);
      applySectionParams(sectionParams);
    } catch (err: any) {
      setError(`读取模板「${pid}」失败：${err?.message || err}`);
    } finally {
      setCopyLoading(false);
    }
  };

  const submit = async () => {
    const name = paramName.trim();
    const id = paramId.trim();

    if (!name) {
      setError('模板名称不能为空');
      return;
    }
    if (!id) {
      setError('模板标识（param_id）不能为空');
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      setError('模板标识只能包含英文字母、数字、下划线和短横线');
      return;
    }
    if (existingIds.has(id)) {
      setError(`模板标识「${id}」已存在，请换一个`);
      return;
    }

    // JSON 草稿是唯一真源：不合法就阻止创建，不能把用户改了一半的内容静默换成默认值
    const risk = commitJsonDraft(riskDraft);
    if (!risk.ok) {
      setError(`风险阈值 JSON 有语法错误：${risk.message}`);
      return;
    }
    const weight = commitJsonDraft(weightsDraft);
    if (!weight.ok) {
      setError(`权重参数 JSON 有语法错误：${weight.message}`);
      return;
    }

    const [waterQs = '', tidalLevel = ''] = hydroValue.split('|');

    const form: CreateParamTemplateForm = {
      param_id: id,
      param_name: name,
      segment: segment.trim(),
      set_name: setName.trim(),
      water_qs: waterQs,
      tidal_level: tidalLevel,
      current_timepoint: currentTimepoint.trim(),
      comparison_timepoint: comparisonTimepoint.trim(),
      bench_id: benchId.trim(),
      ref_id: refId.trim(),
      hs,
      hc,
      protection_level: protectionLevel,
      control_level: controlLevel,
      risk_thresholds: risk.value as Record<string, unknown>,
      weights: weight.value as Record<string, unknown>,
      other_params: { ...otherParams, is_default: false },
    };

    setSubmitting(true);
    setError('');
    try {
      await onSubmit(form, openAfter);
    } catch (err: any) {
      setError(`新建模板失败：${err?.message || err}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={`${styles.container} ${styles.containerMedium}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.title}>新建参数模板</h3>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>名称</legend>

          <div className={styles.mb15}>
            <label className={styles.label}>模板名称</label>
            <input
              ref={nameRef}
              type="text"
              className={styles.input}
              value={paramName}
              onChange={(e) => {
                setParamName(e.target.value);
                if (error) setError('');
              }}
              placeholder="例如：南京段 2023 大潮方案"
            />
          </div>

          <div className={styles.mb15}>
            <label className={styles.label}>模板标识 (param_id)</label>
            <input
              type="text"
              className={`${styles.input} ${styles.monoInput}`}
              value={paramId}
              onChange={(e) => {
                setParamIdTouched(true);
                setParamId(e.target.value);
                if (error) setError('');
              }}
              placeholder="英文/数字/下划线，全库唯一"
            />
            <div className={styles.hint}>
              自动生成，可修改。保存后作为该模板的永久标识，库里必须全库唯一。
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>起始内容</legend>

          <div className={styles.mb15}>
            <label className={styles.label}>复制自</label>
            <select
              className={styles.select}
              value={copyFrom}
              onChange={(e) => { void handleCopyFrom(e.target.value); }}
              disabled={copyLoading}
            >
              <option value="">空白模板（使用内置默认阈值 / 权重）</option>
              {templates.map((t) => (
                <option key={t.param_id} value={t.param_id}>
                  {t.param_name || t.param_id}
                </option>
              ))}
            </select>
            <div className={styles.hint}>
              {copyLoading
                ? '正在读取模板内容…'
                : '选择一份已有模板作为起点，下面的水文条件 / DEM / 阈值 / 权重会一并带过来，再按需修改。'}
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>基础信息</legend>

          <div className={styles.grid2}>
            <div>
              <label>河段编码:</label>
              <input
                type="text"
                className={styles.input}
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder={defaultSegment}
              />
            </div>

            <div>
              <label>数据集名称:</label>
              <input
                type="text"
                className={styles.input}
                value={setName}
                onChange={(e) => setSetName(e.target.value)}
              />
            </div>

            <div>
              <label>当前时间点:</label>
              <input
                type="text"
                className={styles.input}
                value={currentTimepoint}
                onChange={(e) => setCurrentTimepoint(e.target.value)}
                placeholder="YYYYMM"
              />
            </div>

            <div>
              <label>对比时间点:</label>
              <input
                type="text"
                className={styles.input}
                value={comparisonTimepoint}
                onChange={(e) => setComparisonTimepoint(e.target.value)}
                placeholder="YYYYMM"
              />
            </div>

            <div>
              <label>水文条件:</label>
              <select
                className={styles.select}
                value={hydroValue}
                onChange={(e) => setHydroValue(e.target.value)}
              >
                <option value="">请选择</option>
                {hydroOptions.map((option) => {
                  const value = `${option.water_qs}|${option.tidal_level}`;
                  return (
                    <option key={value} value={value}>
                      {formatHydroLabel(option.water_qs, option.tidal_level)}
                    </option>
                  );
                })}
                {hydroValue &&
                  !hydroOptions.some(
                    (option) => `${option.water_qs}|${option.tidal_level}` === hydroValue,
                  ) && (
                    <option value={hydroValue}>
                      {formatHydroLabel(hydroValue.split('|')[0] || '', hydroValue.split('|')[1] || '')}（当前）
                    </option>
                  )}
              </select>
            </div>

            <div>
              <label>砂土层厚度 (hs):</label>
              <input
                type="number"
                step="0.1"
                className={styles.input}
                value={Number.isFinite(hs) ? hs : ''}
                onChange={(e) => setHs(Number(e.target.value))}
              />
            </div>

            <div>
              <label>黏土层厚度 (hc):</label>
              <input
                type="number"
                step="0.1"
                className={styles.input}
                value={Number.isFinite(hc) ? hc : ''}
                onChange={(e) => setHc(Number(e.target.value))}
              />
            </div>

            <div>
              <label>护岸等级:</label>
              <select
                className={styles.select}
                value={protectionLevel}
                onChange={(e) => setProtectionLevel(e.target.value)}
              >
                <option value="">请选择</option>
                <option value="systemic">强</option>
                <option value="normal">较强</option>
                <option value="low">一般</option>
                <option value="no">弱</option>
              </select>
            </div>

            <div>
              <label>工程扰动控制等级:</label>
              <select
                className={styles.select}
                value={controlLevel}
                onChange={(e) => setControlLevel(e.target.value)}
              >
                <option value="">请选择</option>
                <option value="strict">强</option>
                <option value="normal">较强</option>
                <option value="low">一般</option>
                <option value="no">弱</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>DEM参数</legend>
          <div className={styles.grid2}>
            <TiffResourcePicker
              label="基准DEM (bench_id):"
              value={benchId}
              onConfirm={setBenchId}
              defaultUploadSegment={segment}
              defaultUploadYear="2023"
              defaultUploadTimepoint={currentTimepoint}
            />
            <TiffResourcePicker
              label="参考DEM (ref_id):"
              value={refId}
              onConfirm={setRefId}
              defaultUploadSegment={segment}
              defaultUploadYear="2019"
              defaultUploadTimepoint={comparisonTimepoint}
            />
          </div>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>风险阈值 / 权重</legend>

          <div className={styles.mb15}>
            <label className={styles.label}>风险阈值 (JSON)</label>
            <textarea
              className={styles.textarea}
              rows={6}
              spellCheck={false}
              aria-label="风险阈值 JSON"
              value={riskDraft.text}
              onChange={(e) => {
                // 只留文本，不解析回 state（否则非法中间态会被吞掉、光标跳走）
                setRiskDraft(updateJsonDraft(e.target.value));
                if (error) setError('');
              }}
              onBlur={() => setRiskDraft(formatJsonDraft(riskDraft))}
            />
            {riskDraft.error && (
              <div className={riskDraft.incomplete ? styles.hint : styles.errorText}>
                {riskDraft.incomplete ? 'JSON 还没写完，可继续输入：' : 'JSON 语法错误：'}
                {riskDraft.error}
              </div>
            )}
          </div>

          <div>
            <label className={styles.label}>权重参数 (JSON)</label>
            <textarea
              className={styles.textarea}
              rows={5}
              spellCheck={false}
              aria-label="权重参数 JSON"
              value={weightsDraft.text}
              onChange={(e) => {
                setWeightsDraft(updateJsonDraft(e.target.value));
                if (error) setError('');
              }}
              onBlur={() => setWeightsDraft(formatJsonDraft(weightsDraft))}
            />
            {weightsDraft.error && (
              <div className={weightsDraft.incomplete ? styles.hint : styles.errorText}>
                {weightsDraft.incomplete ? 'JSON 还没写完，可继续输入：' : 'JSON 语法错误：'}
                {weightsDraft.error}
              </div>
            )}
          </div>

          <div className={styles.hint}>
            留空即用内置默认值：8 项阈值（Ky / Ln / PQ / Sa / Zb / Zd / all / Dsed）+ 4 组权重（wGE / wNM / wRE / wRL）。
            创建后还可以右键该模板 →「模板属性配置」继续精调。
          </div>
        </fieldset>

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={openAfter}
            onChange={(e) => setOpenAfter(e.target.checked)}
          />
          创建后立即打开「模板属性配置」
        </label>

        {error && <div className={styles.errorText}>{error}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel} disabled={submitting}>
            取消
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => { void submit(); }} disabled={submitting || copyLoading}>
            {submitting ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
