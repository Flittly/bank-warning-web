import { useState } from 'react';
import type { SectionParams } from '../types/sections';
import TiffResourcePicker from './TiffResourcePicker';
import styles from './Modal.module.css';
import { updateSectionParams } from '../pages/editor/sectionApi';

interface SectionPropertiesModalProps {
  config: SectionParams | null;
  onSave: (newConfig: SectionParams) => void | Promise<void>;
  onClose: () => void;
  title: string;
  sectionId?: string;
}

function SectionPropertiesModal({
  config,
  onSave,
  onClose,
  title,
  sectionId
}: SectionPropertiesModalProps) {
  const [params, setParams] = useState<SectionParams>(config || {});
  const [isSaving, setIsSaving] = useState(false);

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

  const handleExport = () => {
    try {
      const jsonText = JSON.stringify(params ?? {}, null, 2);
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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (sectionId) {
        await updateSectionParams(sectionId, params);
      }

      await Promise.resolve(onSave(params));
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
              <label>流量:</label>
              <input
                type="text"
                value={params.water_qs || ''}
                onChange={(e) => setParams({ ...params, water_qs: e.target.value })}
                className={styles.input}
              />
            </div>

            <div>
              <label>潮位:</label>
              <select
                value={params.tidal_level || ''}
                onChange={(e) => setParams({ ...params, tidal_level: e.target.value })}
                className={styles.input}
              >
                <option value="">请选择</option>
                <option value="xc">小潮</option>
                <option value="zc">中潮</option>
                <option value="dc">大潮</option>
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
          <legend className={styles.legend}>水深参数</legend>

          <div className={styles.grid2}>
            <div>
              <label>hs:</label>
              <input
                type="number"
                step="0.1"
                value={params.hs ?? ''}
                onChange={(e) => setParams({ ...params, hs: Number(e.target.value) })}
                className={styles.input}
              />
            </div>

            <div>
              <label>hc:</label>
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

        {/* 防护控制参数 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>防护控制参数</legend>

          <div className={styles.grid2}>
            <div>
              <label>防护等级:</label>
              <select
                value={params.protection_level || ''}
                onChange={(e) => setParams({ ...params, protection_level: e.target.value })}
                className={styles.input}
              >
                <option value="">请选择</option>
                <option value="systemic">系统防护</option>
                <option value="normal">常规防护</option>
                <option value="low">低防护</option>
                <option value="no">无防护</option>
              </select>
            </div>

            <div>
              <label>控制等级:</label>
              <select
                value={params.control_level || ''}
                onChange={(e) => setParams({ ...params, control_level: e.target.value })}
                className={styles.input}
              >
                <option value="">请选择</option>
                <option value="strict">严格控制</option>
                <option value="normal">常规控制</option>
                <option value="low">低控制</option>
                <option value="no">无控制</option>
              </select>
            </div>
          </div>
        </fieldset>

        {/* 风险阈值 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>风险阈值 (JSON格式)</legend>
          <textarea
            value={JSON.stringify(params.risk_thresholds || {}, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                setParams({ ...params, risk_thresholds: parsed });
              } catch {
                // ignore parse error while typing
              }
            }}
            rows={8}
            className={styles.textarea}
          />
          <small className={styles.smallText}>
            示例: {`{"Dsed": [0.3, 0.5, 0.7], "Zb": [2.0, 4.0, 6.0], ...}`}
          </small>
        </fieldset>

        {/* 权重参数 */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>权重参数 (JSON格式)</legend>
          <textarea
            value={JSON.stringify(params.weights || {}, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                setParams({ ...params, weights: parsed });
              } catch {
                // ignore parse error while typing
              }
            }}
            rows={5}
            className={styles.textarea}
          />
          <small className={styles.smallText}>
            示例: {`{"wRE": [0.3, 0.4, 0.3], "wNM": [0.4, 0.3, 0.3], ...}`}
          </small>
        </fieldset>
        <div className={styles.actions}>
          <button
            onClick={onClose}
            disabled={isSaving}
            className={styles.cancelButton}
          >
            取消
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
