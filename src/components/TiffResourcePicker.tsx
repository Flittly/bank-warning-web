import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteTiffResource,
  fetchTiffResources,
  formatTiffResourceLabel,
  normalizeTiffKey,
  uploadTiffResource,
  type TiffResource,
} from '../services/tiffService';
import styles from './Modal.module.css';

const CUSTOM_UPLOAD_VALUE = '__upload_custom_tiff__';

type UploadFormState = {
  file: File | null;
  segment: string;
  year: string;
  timepoint: string;
};

interface TiffResourcePickerProps {
  label: string;
  value: string;
  onConfirm: (value: string) => void;
  defaultUploadSegment?: string;
  defaultUploadYear?: string;
  defaultUploadTimepoint?: string;
}

const sortTiffResources = (resources: TiffResource[]) => {
  return [...resources].sort((left, right) => {
    const leftKey = [left.segment || '', left.year || '', left.timepoint || '', left.tiff_key || ''].join('|');
    const rightKey = [right.segment || '', right.year || '', right.timepoint || '', right.tiff_key || ''].join('|');
    return leftKey.localeCompare(rightKey, 'zh-Hans-CN');
  });
};

function TiffResourcePicker({
  label,
  value,
  onConfirm,
  defaultUploadSegment = '',
  defaultUploadYear = '',
  defaultUploadTimepoint = '',
}: TiffResourcePickerProps) {
  const [resources, setResources] = useState<TiffResource[]>([]);
  const [selectedValue, setSelectedValue] = useState<string>(value || '');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState<UploadFormState>({
    file: null,
    segment: defaultUploadSegment,
    year: defaultUploadYear,
    timepoint: defaultUploadTimepoint,
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSelectedValue(normalizeTiffKey(value || ''));
  }, [value]);

  useEffect(() => {
    if (!isUploadDialogOpen) return;

    setUploadForm({
      file: null,
      segment: defaultUploadSegment,
      year: defaultUploadYear,
      timepoint: defaultUploadTimepoint,
    });
  }, [defaultUploadSegment, defaultUploadTimepoint, defaultUploadYear, isUploadDialogOpen]);

  const loadResources = async (forceRefresh = false) => {
    setIsLoading(true);
    try {
      const list = await fetchTiffResources(forceRefresh);
      setResources(sortTiffResources(list));
    } catch (err: any) {
      console.error('加载 TIFF 列表失败:', err);
      setResources([]);
      setStatusText(err?.message || '加载 TIFF 列表失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadResources();
  }, []);

  const mergedResources = useMemo(() => {
    if (!selectedValue) return resources;
    const normalizedValue = normalizeTiffKey(selectedValue);
    if (resources.some((resource) => normalizeTiffKey(resource.tiff_key) === normalizedValue)) return resources;
    return [...resources, { tiff_key: normalizedValue }];
  }, [resources, selectedValue]);

  const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value;
    if (nextValue === CUSTOM_UPLOAD_VALUE) {
      setIsUploadDialogOpen(true);
      event.target.value = selectedValue;
      return;
    }

    setSelectedValue(nextValue);
    setStatusText(nextValue ? `已选择 ${nextValue}` : '已清空选择');
  };

  const handleConfirm = () => {
    onConfirm(selectedValue);
    setStatusText(selectedValue ? `已确定 ${selectedValue}` : '已清空当前选择');
  };

  const handleDelete = async () => {
    if (!selectedValue) {
      alert('请先选择要删除的 TIFF');
      return;
    }

    const ok = window.confirm(`确认删除 TIFF: ${selectedValue} ?`);
    if (!ok) return;

    setIsDeleting(true);
    try {
      await deleteTiffResource(selectedValue);
      await loadResources(true);
      setSelectedValue('');
      onConfirm('');
      setStatusText(`已删除 ${selectedValue}`);
    } catch (err: any) {
      console.error('删除 TIFF 失败:', err);
      alert(`删除失败: ${err?.message || String(err)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUploadSubmit = async () => {
    if (!uploadForm.file) {
      alert('请先选择 TIFF 文件');
      return;
    }

    if (!uploadForm.segment.trim() || !uploadForm.year.trim() || !uploadForm.timepoint.trim()) {
      alert('请填写河段名、年份和时间点');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadForm.file, uploadForm.file.name);
      formData.append('segment', uploadForm.segment.trim());
      formData.append('year', uploadForm.year.trim());
      formData.append('timepoint', uploadForm.timepoint.trim());

      const uploaded = await uploadTiffResource(formData);
      await loadResources(true);
      setSelectedValue(uploaded.tiff_key);
      setStatusText(`已上传 ${uploaded.tiff_key}，点击“确定”即可应用`);
      setIsUploadDialogOpen(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      console.error('上传 TIFF 失败:', err);
      alert(`上传失败: ${err?.message || String(err)}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={styles.tiffPickerCard}>
      <label className={styles.label}>{label}</label>
      <select className={styles.input} value={selectedValue} onChange={handleSelectChange} disabled={isLoading}>
        <option value="">请选择 DEM</option>
        {mergedResources.map((resource) => (
          <option key={resource.tiff_key} value={resource.tiff_key}>
            {formatTiffResourceLabel(resource)}
          </option>
        ))}
        <option value={CUSTOM_UPLOAD_VALUE}>上传自定义dem</option>
      </select>

      <div className={styles.tiffActionRow}>
        <button type="button" className={styles.cancelButton} onClick={handleConfirm} disabled={isLoading || isUploading || isDeleting}>
          确定
        </button>
        <button type="button" className={styles.cancelButton} onClick={handleDelete} disabled={isLoading || isUploading || isDeleting || !selectedValue}>
          {isDeleting ? '删除中...' : '删除'}
        </button>
      </div>

      <small className={styles.smallText}>
        {statusText || (isLoading ? '正在加载 TIFF 列表...' : '选择已有 DEM，或通过“上传自定义dem”新增资源')}
      </small>

      {isUploadDialogOpen && (
        <div className={styles.subOverlay}>
          <div className={styles.subContainer}>
            <h4 className={styles.subTitle}>上传自定义 DEM</h4>

            <div className={styles.uploadRow}>
              <label className={styles.label}>TIFF 文件:</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".tif,.tiff,image/tiff"
                className={styles.input}
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setUploadForm((prev) => ({ ...prev, file }));
                }}
              />
            </div>

            <div className={styles.grid2}>
              <div>
                <label className={styles.label}>河段名:</label>
                <input
                  type="text"
                  className={styles.input}
                  value={uploadForm.segment}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, segment: event.target.value }))}
                />
              </div>

              <div>
                <label className={styles.label}>年份:</label>
                <input
                  type="text"
                  className={styles.input}
                  value={uploadForm.year}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, year: event.target.value }))}
                />
              </div>

              <div>
                <label className={styles.label}>时间点:</label>
                <input
                  type="text"
                  className={styles.input}
                  value={uploadForm.timepoint}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, timepoint: event.target.value }))}
                  placeholder="如 202104"
                />
              </div>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.cancelButton} onClick={() => setIsUploadDialogOpen(false)} disabled={isUploading}>
                取消
              </button>
              <button type="button" className={styles.primaryButton} onClick={handleUploadSubmit} disabled={isUploading}>
                {isUploading ? '上传中...' : '上传'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TiffResourcePicker;
