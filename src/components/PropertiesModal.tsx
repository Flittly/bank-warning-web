import { useEffect, useState } from 'react';
import type { AnalysisConfig } from '../constants';
import TiffResourcePicker from './TiffResourcePicker';
import styles from './Modal.module.css';
import { updateSectionParams } from '../pages/editor/sectionApi';

type AnalysisConfigDraft = Record<string, any>;

export default function PropertiesModal({
  config,
  onSave,
  onClose,
  title,
  sectionId
}: {
  config: AnalysisConfig;
  onSave: (newConfig: AnalysisConfig) => void;
  onClose: () => void;
  title: string;
  sectionId?: string;
}) {
  const [draftConfig, setDraftConfig] = useState<AnalysisConfigDraft>(() => ({ ...config }));
  const years = Array.from({ length: 17 }, (_, i) => (2010 + i).toString());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftConfig({ ...config });
  }, [config]);

  const sanitizeFileName = (name: string) => {
    const base = (name || 'config').trim() || 'config';
    return base.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_').slice(0, 120);
  };

  const handleExport = () => {
    try {
      const jsonText = JSON.stringify(draftConfig ?? {}, null, 2);
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
      const updatedConfig = { ...draftConfig } as AnalysisConfig;
      
      if (sectionId) {
        await updateSectionParams(sectionId, updatedConfig as any);
      }

      onSave(updatedConfig as any);
      onClose();
    } catch (err) {
      alert('保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.mb15}>
          <label className={styles.label}>年份 (year) - 可编辑:</label>
          <select value={draftConfig.year} onChange={(e) => setDraftConfig((prev) => ({ ...prev, year: e.target.value }))} className={styles.input}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>DEM参数</legend>

          <div className={styles.grid2}>
            <TiffResourcePicker
              label="基准DEM (bench-id):"
              value={draftConfig['bench-id'] || ''}
              onConfirm={(nextValue) => setDraftConfig((prev) => ({ ...prev, ['bench-id']: nextValue }))}
              defaultUploadSegment={String(draftConfig.segment || '')}
              defaultUploadYear={String(draftConfig.year || '')}
              defaultUploadTimepoint={String(draftConfig['current-timepoint'] || '')}
            />

            <TiffResourcePicker
              label="参考DEM (ref-id):"
              value={draftConfig['ref-id'] || ''}
              onConfirm={(nextValue) => setDraftConfig((prev) => ({ ...prev, ['ref-id']: nextValue }))}
              defaultUploadSegment={String(draftConfig.segment || '')}
              defaultUploadYear={String(draftConfig.year || '')}
              defaultUploadTimepoint={String(draftConfig['comparison-timepoint'] || draftConfig['current-timepoint'] || '')}
            />

            <TiffResourcePicker
              label="通用DEM (dem-id):"
              value={draftConfig['dem-id'] || ''}
              onConfirm={(nextValue) => setDraftConfig((prev) => ({ ...prev, ['dem-id']: nextValue }))}
              defaultUploadSegment={String(draftConfig.segment || '')}
              defaultUploadYear={String(draftConfig.year || '')}
              defaultUploadTimepoint={String(draftConfig['current-timepoint'] || draftConfig['comparison-timepoint'] || '')}
            />
          </div>
        </fieldset>

        <div className={`${styles.muted} ${styles.mb15}`}>
          <label className={styles.label}>其他属性（仅展示）:</label>
          <pre className={styles.preBox}>
            {JSON.stringify({
              'current-timepoint': draftConfig['current-timepoint'], 'comparison-timepoint': draftConfig['comparison-timepoint'],
              segment: draftConfig.segment, set: draftConfig.set, 'water-qs': draftConfig['water-qs'], 'tidal-level': draftConfig['tidal-level'],
              hs: draftConfig.hs, hc: draftConfig.hc, 'protection-level': draftConfig['protection-level'], 'control-level': draftConfig['control-level'],
              'risk-thresholds': draftConfig['risk-thresholds'], wNM: draftConfig.wNM, wRE: draftConfig.wRE, wGE: draftConfig.wGE, wRL: draftConfig.wRL
            }, null, 2)}
          </pre>
        </div>
        <div className={styles.actions}>
          <button onClick={onClose} disabled={isSaving} className={styles.cancelButton}>取消</button>
          <button onClick={handleExport} disabled={isSaving} className={styles.cancelButton}>导出</button>
          <button onClick={handleSave} disabled={isSaving} className={styles.primaryButton}>
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
