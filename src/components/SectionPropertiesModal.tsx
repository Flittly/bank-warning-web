import { useEffect, useState } from 'react';
import type { SectionParams } from '../types/sections';
import TiffResourcePicker from './TiffResourcePicker';
import styles from './Modal.module.css';
import { commitJsonDraft, createJsonDraft, formatJsonDraft, updateJsonDraft } from '../utils/jsonDraft';

const TIDE_LABELS: Record<string, string> = { xc: '小潮', zc: '中潮', dc: '大潮' };

const formatHydroLabel = (waterQs: string, tidalLevel: string) => {
  const flow = waterQs ? `${waterQs} m³/s` : '未设流量';
  const tide = TIDE_LABELS[tidalLevel] || tidalLevel || '未设潮位';
  return `${flow} · ${tide}`;
};

interface SectionPropertiesModalProps {
  config: SectionParams | null;
  onSave: (newConfig: SectionParams) => void | Promise<void>;
  onClose: () => void;
  title: string;
  sectionId?: string;
  /**
   * 仅「任务参数」面板提供：从模板库拷一份覆盖本任务。
   * 复制后两者再无关联，改模板不会回头影响这个任务。
   */
  templateOptions?: Array<{ param_id: string; param_name: string }>;
  onImportTemplate?: (paramId: string) => void | Promise<void>;
}

/**
 * 参数编辑弹窗（纯表单）。
 *
 * 这里**刻意不再有「应用范围」下拉**：那个下拉曾提供「下发到全部断面」，
 * 而参数模板是全库共享的一份，选一次就能改掉所有历史任务的输入
 * （2026-10-17 实测：模板 166 下 13822 条断面、横跨 15 个任务被一次改写）。
 * 现在作用域由调用方决定且唯一：
 *   · 任务参数面板 → 只写本任务；
 *   · 模板库面板   → 只写模板本身；
 *   · 单断面面板   → 只写这一条断面。
 * 弹窗只负责收集值，不再提供任何批量下发入口。
 */
function SectionPropertiesModal({
  config,
  onSave,
  onClose,
  title,
  sectionId,
  templateOptions,
  onImportTemplate,
}: SectionPropertiesModalProps) {
  const [params, setParams] = useState<SectionParams>(config || {});
  const [isSaving, setIsSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [hydroOptions, setHydroOptions] = useState<Array<{ water_qs: string; tidal_level: string }>>([]);
  /**
   * 两个 JSON 字段走「草稿」而不是直接写进 params：
   * 直接把 `JSON.stringify(params.risk_thresholds)` 当受控 value、onChange 里 parse 成功才回写，
   * 会让任何非法中间态（删掉一个字符、数字打到一半）被静默丢弃 —— 表现就是这两个框根本改不动。
   * 详见 utils/jsonDraft.ts 的注释。
   */
  const [riskDraft, setRiskDraft] = useState(() => createJsonDraft(config?.risk_thresholds ?? {}));
  const [weightsDraft, setWeightsDraft] = useState(() => createJsonDraft(config?.weights ?? {}));
  const [saveError, setSaveError] = useState('');

  const hydroValue =
    params.water_qs || params.tidal_level ? `${params.water_qs || ''}|${params.tidal_level || ''}` : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/v0/bank/hydro-conditions');
        const data = await response.json();
        if (!cancelled && Array.isArray(data?.conditions)) {
          setHydroOptions(data.conditions);
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

  const updateDemField = (field: 'bench_id' | 'ref_id', nextValue: string) => {
    setParams((prev) => {
      const next = { ...prev } as SectionParams & Record<string, any>;
      if (nextValue) {
        next[field] = nextValue;
      } else {
        delete next[field];
      }
      return next;
    });
  };

  const extractYear = (value?: string) => {
    const match = String(value || '').match(/\d{4}/);
    return match ? match[0] : '';
  };

  const normalizeTimepoint = (value?: string) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length >= 6) return digits.slice(0, 6);
    if (digits.length === 4) return `${digits}01`;
    return digits;
  };

  const sanitizeFileName = (name: string) => {
    const base = (name || 'config').trim() || 'config';
    return base.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').slice(0, 120);
  };

  /**
   * 把两个 JSON 草稿合进 params。
   * 任一 JSON 语法不合法就返回失败 —— 绝不「静默用旧值保存」，那会让用户以为改成功了。
   * 留空（提交值为 undefined）表示使用内置默认值，字段随 JSON.stringify 一起略过，后端存 NULL。
   */
  const buildPayload = ():
    | { ok: true; params: SectionParams }
    | { ok: false; message: string } => {
    const risk = commitJsonDraft(riskDraft);
    if (!risk.ok) return { ok: false, message: `风险阈值 JSON 有语法错误：${risk.message}` };
    const weight = commitJsonDraft(weightsDraft);
    if (!weight.ok) return { ok: false, message: `权重参数 JSON 有语法错误：${weight.message}` };
    return {
      ok: true,
      params: {
        ...params,
        risk_thresholds: risk.value as SectionParams['risk_thresholds'],
        weights: weight.value as SectionParams['weights'],
      },
    };
  };

  const handleExport = () => {
    const payload = buildPayload();
    if (!payload.ok) {
      setSaveError(payload.message);
      return;
    }
    try {
      const jsonText = JSON.stringify(payload.params ?? {}, null, 2);
      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      const baseName = sanitizeFileName(title);
      const sid = sectionId ? `_${sanitizeFileName(sectionId)}` : '';
      a.href = url;
      a.download = `${baseName}${sid}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('导出 JSON 失败:', err);
      alert('导出失败，请重试');
    }
  };

  const handleCopy = async () => {
    const payload = buildPayload();
    if (!payload.ok) {
      setSaveError(payload.message);
      return;
    }
    const newName = window.prompt('复制为（参数名称）：', (params.param_name || '') + '_副本');
    if (!newName) return;
    const newParamId = (params.param_name || 'param') + '_copy_' + Date.now();
    try {
      const body = { ...payload.params, param_id: newParamId, param_name: newName };
      await fetch('/v0/bank/basic-params', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: [body], overwrite: false }),
      });
      alert('模板已复制：' + newName);
      onClose();
    } catch (err: any) {
      alert('复制失败：' + err.message);
    }
  };

  const handleSave = async () => {
    const payload = buildPayload();
    if (!payload.ok) {
      setSaveError(payload.message);
      return;
    }
    setSaveError('');
    setIsSaving(true);
    try {
      await Promise.resolve(onSave(payload.params));
      onClose();
    } catch (err: any) {
      console.error('保存参数失败:', err);
      alert(`保存失败: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <h3 className={styles.title}>{title}</h3>

        {/* 基础信息 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>基础信息</legend>

          <div className={styles.grid2}>
            <div>
              <label>参数名称:</label>
              <input
                type="text"
                value={params.param_name || ''}
                onChange={(e) => setParams({ ...params, param_name: e.target.value })}
                className={styles.input}
              />
            </div>

            <div>
              <label>河段编码:</label>
              <input
                type="text"
                value={params.segment || ''}
                onChange={(e) => setParams({ ...params, segment: e.target.value })}
                className={styles.input}
              />
            </div>

            <div>
              <label>当前时间点:</label>
              <input
                type="text"
                value={params.current_timepoint || ''}
                onChange={(e) => setParams({ ...params, current_timepoint: e.target.value })}
                placeholder="YYYY-MM-DD"
                className={styles.input}
              />
            </div>

            <div>
              <label>对比时间点:</label>
              <input
                type="text"
                value={params.comparison_timepoint || ''}
                onChange={(e) => setParams({ ...params, comparison_timepoint: e.target.value })}
                placeholder="YYYY-MM-DD"
                className={styles.input}
              />
            </div>

            <div>
              <label>数据集名称:</label>
              <input
                type="text"
                value={params.set_name || ''}
                onChange={(e) => setParams({ ...params, set_name: e.target.value })}
                className={styles.input}
              />
            </div>

            <div>
              <label>水文条件:</label>
              <select
                value={hydroValue}
                onChange={(e) => {
                  const [waterQs = '', tidalLevel = ''] = e.target.value.split('|');
                  setParams({ ...params, water_qs: waterQs, tidal_level: tidalLevel });
                }}
                className={styles.input}
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
                    (option) => `${option.water_qs}|${option.tidal_level}` === hydroValue
                  ) && (
                    <option value={hydroValue}>
                      {formatHydroLabel(params.water_qs || '', params.tidal_level || '')}（当前）
                    </option>
                  )}
              </select>
            </div>
          </div>
        </fieldset>

        {/* DEM参数 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>DEM参数</legend>

          <div className={styles.grid2}>
            <TiffResourcePicker
              label="基准DEM (bench_id):"
              value={params.bench_id || ''}
              onConfirm={(nextValue) => updateDemField('bench_id', nextValue)}
              defaultUploadSegment={params.segment || ''}
              defaultUploadYear={extractYear(params.current_timepoint || params.comparison_timepoint)}
              defaultUploadTimepoint={normalizeTimepoint(params.current_timepoint || params.comparison_timepoint)}
            />

            <TiffResourcePicker
              label="参考DEM (ref_id):"
              value={params.ref_id || ''}
              onConfirm={(nextValue) => updateDemField('ref_id', nextValue)}
              defaultUploadSegment={params.segment || ''}
              defaultUploadYear={extractYear(params.comparison_timepoint || params.current_timepoint)}
              defaultUploadTimepoint={normalizeTimepoint(params.comparison_timepoint || params.current_timepoint)}
            />
          </div>
        </fieldset>

        {/* 水深参数 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>砂土层厚度 / 黏土层厚度</legend>

          <div className={styles.grid2}>
            <div>
              <label>砂土层厚度 (hs):</label>
              <input
                type="number"
                step="0.1"
                value={params.hs ?? ''}
                onChange={(e) => setParams({ ...params, hs: Number(e.target.value) })}
                className={styles.input}
              />
            </div>

            <div>
              <label>黏土层厚度 (hc):</label>
              <input
                type="number"
                step="0.1"
                value={params.hc ?? ''}
                onChange={(e) => setParams({ ...params, hc: Number(e.target.value) })}
                className={styles.input}
              />
            </div>
          </div>
        </fieldset>

        {/* 护岸工程条件 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>护岸工程条件</legend>

          <div className={styles.grid2}>
            <div>
              <label>护岸等级:</label>
              <select
                value={params.protection_level || ''}
                onChange={(e) => setParams({ ...params, protection_level: e.target.value })}
                className={styles.input}
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
                value={params.control_level || ''}
                onChange={(e) => setParams({ ...params, control_level: e.target.value })}
                className={styles.input}
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

        {/* 风险阈值 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>风险阈值 (JSON格式)</legend>
          <textarea
            value={riskDraft.text}
            onChange={(e) => {
              // 只更新文本，不做「parse 成功才回写」——那样会把非法中间态整个吞掉
              setRiskDraft(updateJsonDraft(e.target.value));
              if (saveError) setSaveError('');
            }}
            onBlur={() => setRiskDraft(formatJsonDraft(riskDraft))}
            rows={8}
            spellCheck={false}
            className={styles.textarea}
            aria-label="风险阈值 JSON"
          />
          {riskDraft.error ? (
            <div className={riskDraft.incomplete ? styles.hint : styles.errorText}>
              {riskDraft.incomplete ? 'JSON 还没写完，可继续输入：' : 'JSON 语法错误：'}
              {riskDraft.error}
            </div>
          ) : (
            <small className={styles.smallText}>
              示例: {`{"Dsed": [0.3, 0.5, 0.7], "Zb": [2.0, 4.0, 6.0], ...}`}
            </small>
          )}
        </fieldset>

        {/* 权重参数 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>权重参数 (JSON格式)</legend>
          <textarea
            value={weightsDraft.text}
            onChange={(e) => {
              setWeightsDraft(updateJsonDraft(e.target.value));
              if (saveError) setSaveError('');
            }}
            onBlur={() => setWeightsDraft(formatJsonDraft(weightsDraft))}
            rows={5}
            spellCheck={false}
            className={styles.textarea}
            aria-label="权重参数 JSON"
          />
          {weightsDraft.error ? (
            <div className={weightsDraft.incomplete ? styles.hint : styles.errorText}>
              {weightsDraft.incomplete ? 'JSON 还没写完，可继续输入：' : 'JSON 语法错误：'}
              {weightsDraft.error}
            </div>
          ) : (
            <small className={styles.smallText}>
              示例: {`{"wRE": [0.3, 0.4, 0.3], "wNM": [0.4, 0.3, 0.3], ...}`}
            </small>
          )}
        </fieldset>
        {saveError && <div className={styles.errorText}>{saveError}</div>}
        <div className={styles.actions}>
          {onImportTemplate && templateOptions && templateOptions.length > 0 && (
            <select
              value=""
              disabled={importing || isSaving}
              onChange={async (e) => {
                const nextId = e.target.value;
                if (!nextId) return;
                if (!window.confirm('用该模板库模板覆盖本任务的参数？本任务断面会被同步，需重跑才会更新结果。')) return;
                setImporting(true);
                try {
                  await Promise.resolve(onImportTemplate(nextId));
                } finally {
                  setImporting(false);
                }
              }}
              className={styles.select}
              title="从模板库复制一份到本任务（之后互不影响）"
            >
              <option value="">{importing ? '导入中…' : '从模板库导入…'}</option>
              {templateOptions.map((t) => (
                <option key={t.param_id} value={t.param_id}>{t.param_name || t.param_id}</option>
              ))}
            </select>
          )}
          <button
            onClick={onClose}
            disabled={isSaving}
            className={styles.cancelButton}
          >
            取消
          </button>
          <button
            onClick={handleCopy}
            className={styles.cancelButton}
          >
            复制
          </button>
          <button
            onClick={handleExport}
            disabled={isSaving}
            className={styles.cancelButton}
          >
            导出
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={styles.primaryButton}
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SectionPropertiesModal;
