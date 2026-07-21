import { 
  Upload, 
  Settings, 
  MousePointer2, 
  CheckCircle2, 
  Ruler, 
  Layers, 
  Activity, 
  Plus, 
  Trash2, 
  ChevronRight, 
  ChevronDown, 
  RotateCw,
  Eye,
  EyeOff,
  Eraser,
  Check,
  Zap,
  Globe,
  Layout,
  Download,
  MoveHorizontal,
  Move
} from 'lucide-react';
import { useState } from 'react';
import type { SelectionGroup } from '../types/selection';
import styles from './EditorSidebar.module.css';

interface EditorSidebarProps {
  uploadedData: GeoJSON.FeatureCollection | null;
  bankGroups: Array<{ region_code: string; count: number }>;
  bankList: any[];
  deleteBankById: (bankId: string) => void;
  deleteBanksByIds: (bankIds: string[]) => void;
  smoothSelectedShoreLines: () => void;
  selectedBankGroup: string[];
  setSelectedBankGroup: (v: string[]) => void;
  onBankSelect?: (bankIds: string[]) => void;
  loadBankById?: (bankId: string) => Promise<void>;
  removeBankFromMap?: (bankId: string) => void;
  onBankParamsView?: (bankId: string) => void;
  deleteBankGroup: () => void;
  loadedBanks: any[];
  selectedLoadedBanks: Set<string>;
  setSelectedLoadedBanks: (v: Set<string>) => void;
  deleteLoadedBanks: () => void;
  basicParamsList: any[];
  selectedBasicParamIdState: string | number | null;
  totalSelectedSegments: number;
  totalCrossLinesCount: number;
  globalInterval: number;
  setGlobalInterval: (v: number) => void;
  globalLength: number;
  setGlobalLength: (v: number) => void;
  isSelectingShoreLines: boolean;
  toggleShoreLineSelection: () => void;
  toggleSelectAllShoreLines: () => void;
  selectedLinesSize: number;
  handleGenerateSections: () => void;
  handleGenerateComputeSections: () => void;
  isFixingShoreLineReversed: boolean;
  toggleFixShoreLineReversed: () => void;
  sendSelectedShoreLinesGeoJson: () => void;
  perpendicularData: GeoJSON.FeatureCollection | null;
  openGlobalPropertiesModal: () => void;
  isSelectingStartEnd: boolean;
  toggleStartEndSelection: () => void;
  groups: SelectionGroup[];
  editingGroupId: string | null;
  handleEditGroup: (id: string) => void;
  deleteGroup: (id: string) => void;
  updateGroupConfig: (id: string, field: 'interval' | 'length', value: number) => void;
  reverseCrossLinesInGroup: (groupId: string) => void;
  deleteCrossLinesInGroup: (groupId: string) => void;
  setEditingPropertiesGroupId: (id: string | null) => void;
  handleApplyCustomSegments: () => void;
  isSelectingCrossLines: boolean;
  toggleCrossLineSelection: () => void;
  validateAllPendingSections: () => void;
  deleteAllInvalidSections: () => Promise<void>;
  crossLineControlMode: 'shoreline' | 'free';
  setCrossLineControlMode: (mode: 'shoreline' | 'free') => void;
  crossLineEditMode: 'none' | 'select' | 'add';
  setCrossLineEditMode: (mode: 'none' | 'select' | 'add') => void;
  clearSelectedCrossLineSelection: () => void;
  selectedCrossLineIndex: number | null;
  translateSelectedCrossLine: (offset: number) => void;
  rotateSelectedCrossLine: (angleDegrees: number) => void;
  scaleSelectedCrossLine: (deltaMeters: number) => void;
  configureSelectedCrossLineProperties: () => void;
  deleteSelectedCrossLine: () => void;
  reverseSelectedCrossLine: () => void;
  showCrossLines: boolean;
  setShowCrossLines: (v: boolean) => void;
  showTiffBounds: boolean;
  setShowTiffBounds: (v: boolean) => void;
  satellite?: boolean;
  setSatellite?: (v: boolean) => void;
  handleStartAnalysis: () => void;
  onClear: () => void;
  onSelectBanksByTiff?: () => void;
  onClipBank?: () => void;
  colorBanks?: boolean;
  setColorBanks?: (v: boolean) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSectionsFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSelectBasicParam: (id: string | null) => void;
  onExportSections: () => void;
  clippedBanks: any[];
}

function EditorSidebar(props: EditorSidebarProps) {
  const {
    uploadedData,
    bankGroups,
    selectedBankGroup,
    setSelectedBankGroup,
    onBankSelect,
    loadBankById,
    removeBankFromMap,
    onBankParamsView,
    deleteBankGroup,
    bankList,
    deleteBankById,
    deleteBanksByIds,
    smoothSelectedShoreLines,
    basicParamsList,
    selectedBasicParamIdState,
    // totalSelectedSegments, (unused)
    totalCrossLinesCount,
    globalInterval,
    setGlobalInterval,
    globalLength,
    setGlobalLength,
    isSelectingShoreLines,
    toggleShoreLineSelection,
    toggleSelectAllShoreLines,
    selectedLinesSize,
    handleGenerateSections,
    handleGenerateComputeSections,
    isFixingShoreLineReversed,
    toggleFixShoreLineReversed,
    sendSelectedShoreLinesGeoJson,
    perpendicularData,
    openGlobalPropertiesModal,
    isSelectingStartEnd,
    toggleStartEndSelection,
    groups,
    editingGroupId,
    handleEditGroup,
    deleteGroup,
    updateGroupConfig,
    reverseCrossLinesInGroup,
    deleteCrossLinesInGroup,
    setEditingPropertiesGroupId,
    handleApplyCustomSegments,
    isSelectingCrossLines,
    toggleCrossLineSelection,
    validateAllPendingSections,
    deleteAllInvalidSections,
    crossLineControlMode,
    setCrossLineControlMode,
    crossLineEditMode,
    setCrossLineEditMode,
    clearSelectedCrossLineSelection,
    selectedCrossLineIndex,
    translateSelectedCrossLine,
    rotateSelectedCrossLine,
    scaleSelectedCrossLine,
    configureSelectedCrossLineProperties,
    deleteSelectedCrossLine,
    reverseSelectedCrossLine,
    showCrossLines,
    setShowCrossLines,
    showTiffBounds,
    setShowTiffBounds,
    satellite,
    setSatellite,
    handleStartAnalysis,
    onClear,
    onSelectBanksByTiff,
    onClipBank,
    colorBanks,
    setColorBanks,
    handleFileUpload,
    handleSectionsFileUpload,
    handleSelectBasicParam,
    onExportSections,
    loadedBanks,
    selectedLoadedBanks,
    setSelectedLoadedBanks,
    deleteLoadedBanks,
    clippedBanks,
  } = props;

  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const activeSelectedBank = selectedBankGroup[selectedBankGroup.length - 1] || '';

  return (
    <div className={styles.sidebarContainer}>
      <div className={styles.sidebarContent}>
        {/* 数据加载 */}
        <section className={styles.configSection}>
          <div className={styles.sectionTitle}>
            <Upload size={14} /> 创建岸段
          </div>
          <div className={styles.card}>
            <div className={styles.buttonGrid}>
              <label className={styles.primaryButton} style={{ gridColumn: '1 / -1' }} data-tour="upload-bank">
                <Upload size={16} /> 上传岸段
                <input
                  type="file"
                  className={styles.fileInput}
                  accept=".geojson,application/json"
                  onChange={handleFileUpload}
                />
              </label>
            </div>

            <div className={`${styles.inputGroup} ${styles.bankSelectGroup}`}>
              <div className={styles.bankSelectHeader}>
                <span className={styles.bankSelectLabel}>本地岸段:</span>
                {selectedBankGroup.length > 0 && (
                  <span className={styles.bankSelectCount}>已选 {selectedBankGroup.length} 条</span>
                )}
              </div>
              <div className={styles.bankSelect} data-tour="bank-list">
                {bankList && bankList.length > 0
                  ? bankList.filter((b: any) => !String(b.bank_id || '').includes('_clip_')).map((b) => (
                        <div
                        key={String(b.bank_id)}
                        className={`${styles.loadedBankItem} ${selectedBankGroup.includes(String(b.bank_id)) ? styles.selected : ''}`}
                      >
                        <div className={styles.loadedBankItemMain}
                          onClick={(e: React.MouseEvent) => {
                            const bankId = String(b.bank_id);
                            const isSelected = selectedBankGroup.includes(bankId);
                            const currentIndex = (bankList || []).indexOf(b);

                            if (e.shiftKey && lastClickedIndex !== null && lastClickedIndex !== currentIndex && currentIndex !== -1) {
                              const start = Math.min(lastClickedIndex, currentIndex);
                              const end = Math.max(lastClickedIndex, currentIndex);
                              const rangeIds = (bankList || []).slice(start, end + 1).map(bk => String(bk.bank_id));
                              const newSelected = [...new Set([...selectedBankGroup, ...rangeIds])];
                              setSelectedBankGroup(newSelected);
                              rangeIds.forEach(id => { if (!selectedBankGroup.includes(id)) loadBankById?.(id); });
                            } else if (isSelected) {
                              setSelectedBankGroup(selectedBankGroup.filter(v => v !== bankId));
                              removeBankFromMap?.(bankId);
                            } else {
                              setSelectedBankGroup([...selectedBankGroup, bankId]);
                              loadBankById?.(bankId);
                            }
                            setLastClickedIndex(currentIndex);
                          }}
                        >
                          <span className={styles.loadedBankItemName}>{b.bank_name || b.bank_id}</span>
                          <span className={styles.loadedBankItemId}>{b.bank_id}</span>
                        </div>
                        <button
                          className={styles.bankParamsBtn}
                          onClick={(e) => { e.stopPropagation(); onBankParamsView?.(String(b.bank_id)); }}
                          title="查看参数配置"
                        ><Settings size={14} /></button>
                      </div>
                    ))
                  : bankGroups.map((g) => (
                      <div
                        key={g.region_code}
                        className={styles.loadedBankItem}
                      >
                        <span>{g.region_code}（{g.count} 条）</span>
                      </div>
                    ))}
              </div>
            </div>
            <div className={`${styles.mt12} ${styles.buttonGrid}`}>
              <button
                type="button"
                className={styles.outlineButton}
                onClick={() => {
                  if (!activeSelectedBank) return;
                  // 若选中的是 region_code，则批量删除组（保留原行为，仅支持单选）
                  const isRegion = bankGroups.some((g) => g.region_code === activeSelectedBank);
                  if (isRegion) {
                    if (selectedBankGroup.length !== 1) {
                      alert('删除岸段组仅支持单选一个 region_code，请先只选择一个再删除');
                      return;
                    }
                    deleteBankGroup();
                    return;
                  }

                  // bank_id：支持单删/多选批量删
                  if (selectedBankGroup.length > 1) {
                    deleteBanksByIds(selectedBankGroup);
                  } else {
                    deleteBankById(activeSelectedBank);
                  }
                }}
                title="删除当前选择的岸段（支持单条 bank_id 或按 region_code 批量删除）"
                aria-label="删除岸段"
                disabled={!activeSelectedBank}
              >
                <Trash2 size={16} /> 删除
              </button>
              <button
                type="button"
                className={styles.outlineButton}
                onClick={smoothSelectedShoreLines}
                title="对拾取选中的岸段执行平滑；可多次点击逐步增强"
                aria-label="平滑岸段"
                disabled={!uploadedData || selectedLinesSize === 0}
              >
                <Zap size={16} /> 平滑
              </button>
            </div>

            <div className={styles.mt12}>
              <button type="button" className={styles.outlineButton} onClick={onSelectBanksByTiff} title="根据当前模板 DEM 范围自动选择岸段">
                <Layers size={14} /> 按TIF选岸段
              </button>
            </div>

            {/* 已加载岸段管理 */}
            {loadedBanks && loadedBanks.length > 0 && (
              <div className={`${styles.inputGroup} ${styles.mt12}`}>
                <div className={styles.bankSelectHeader}>
                  <span className={styles.bankSelectLabel}>已加载岸段:</span>
                  <span className={styles.bankSelectCount}>{selectedLoadedBanks.size}/{loadedBanks.length}</span>
                </div>
                <div className={styles.loadedBanksList}>
                  {loadedBanks.map((bank) => {
                    const bankId = String(bank.bank_id);
                    const isSelected = selectedLoadedBanks.has(bankId);
                    const bankName = String(bank.bank_name || bank.bankName || bank.region_code || bankId);
                    return (
                      <div
                        key={bankId}
                        className={`${styles.loadedBankItem} ${isSelected ? styles.selected : ''}`}
                        onClick={(e) => {
                          const newSelected = new Set(selectedLoadedBanks);
                          if (e.ctrlKey || e.metaKey) {
                            // Ctrl/Cmd 点击：切换选中状态
                            if (newSelected.has(bankId)) {
                              newSelected.delete(bankId);
                            } else {
                              newSelected.add(bankId);
                            }
                          } else if (e.shiftKey) {
                            // Shift 点击：范围选择（简单实现，仅在最后选中项和当前项间切换）
                            if (newSelected.size === 0) {
                              newSelected.add(bankId);
                            } else if (newSelected.has(bankId)) {
                              newSelected.clear();
                            } else {
                              newSelected.clear();
                              newSelected.add(bankId);
                            }
                          } else {
                            // 普通点击：单选
                            newSelected.clear();
                            newSelected.add(bankId);
                          }
                          setSelectedLoadedBanks(newSelected);
                        }}
                      >
                        <div className={styles.loadedBankItemMain}>
                          <span className={styles.loadedBankItemName}>{bankName}</span>
                          <span className={styles.loadedBankItemId}>{bankId}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className={`${styles.outlineButton} ${styles.clearBanksButton}`}
                  onClick={deleteLoadedBanks}
                  disabled={selectedLoadedBanks.size === 0}
                  title="从地图上清除已选岸段"
                  aria-label="清除岸段"
                >
                  <Trash2 size={16} /> 清除({selectedLoadedBanks.size})
                </button>
              </div>
            )}

            {uploadedData && (
              <div className={styles.hintText}>
                要素: {uploadedData.features.length} | 选段: {selectedLinesSize} | 断面: {totalCrossLinesCount}
              </div>
            )}
          </div>
        </section>

        {/* 岸段配置 */}
        <section className={styles.configSection}>
          <div className={styles.sectionTitle}>
            <Layers size={14} /> 生成断面
          </div>

          {/* 方式一：上传断面 JSON */}
          <div className={styles.card}>
              <div className={styles.hintText} style={{ marginBottom: 8, color: '#1e293b', fontSize: '0.85rem', fontWeight: 700 }}>
                方式一：上传断面（JSON）
              </div>
              <label className={styles.primaryButton} style={{ width: '100%', marginBottom: 16 }}>
              <Upload size={16} /> 上传断面
              <input
                type="file"
                className={styles.fileInput}
                accept=".geojson,application/json"
                onChange={handleSectionsFileUpload}
              />
            </label>

              <div className={styles.hintText} style={{ marginBottom: 8, color: '#1e293b', fontSize: '0.85rem', fontWeight: 700 }}>
                方式二：手动创建断面
              </div>
            <div className={styles.buttonGrid} data-tour="select-bank-lines">
              <button
                type="button"
                className={`${styles.outlineButton} ${isSelectingShoreLines ? styles.active : ''}`}
                onClick={toggleShoreLineSelection}
              >
                {isSelectingShoreLines ? <Check size={16} /> : <MousePointer2 size={16} />}
                {isSelectingShoreLines ? '选择中' : '选中岸段'}
              </button>
              <button 
                type="button" 
                className={styles.outlineButton} 
                onClick={toggleSelectAllShoreLines}
                title={uploadedData && selectedLinesSize === (uploadedData.features.filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString').length) && selectedLinesSize > 0 ? "取消全选" : "全选岸段"}
              >
                <CheckCircle2 size={16} /> 
                {uploadedData && selectedLinesSize === (uploadedData.features.filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString').length) && selectedLinesSize > 0 ? "取消" : "全选"}
              </button>
            </div>

            <div className={styles.inlineGroup}>
              <div className={styles.inlineField}>
                <label>断面间距 (m):</label>
                <input
                  type="number"
                  value={globalInterval}
                  onChange={(e) => setGlobalInterval(Number(e.target.value))}
                  min="10"
                  step="10"
                />
              </div>
              <div className={styles.inlineField}>
                <label>断面长度 (m):</label>
                <input
                  type="number"
                  value={globalLength}
                  onChange={(e) => setGlobalLength(Number(e.target.value))}
                  min="100"
                  step="100"
                />
              </div>
            </div>

            <div className={styles.mt12} data-tour="generate-sections">
              <button type="button" className={styles.primaryButton} onClick={handleGenerateSections}>
                <Ruler size={16} /> 生成展示断面
              </button>
            </div>

            <div className={styles.mt12}>
              <button type="button" className={styles.primaryButton} onClick={handleGenerateComputeSections}>
                <Ruler size={16} /> 生成计算断面
              </button>
            </div>

              {perpendicularData && perpendicularData.features.length > 0 && (
                <div className={styles.mt12}>
                  <div className={styles.hintText} style={{ marginBottom: 6, color: '#1e293b', fontSize: '0.85rem', fontWeight: 700 }}>
                    断面编辑
                  </div>
                  <div className={styles.buttonGrid}>
                    <button type="button" className={styles.outlineButton} onClick={validateAllPendingSections} title="强制重新校验全部断面" aria-label="断面检查">
                      <CheckCircle2 size={16} /> 断面检查
                    </button>
                    <button type="button" className={styles.outlineButton} onClick={() => { void deleteAllInvalidSections(); }} title="一键删除所有未通过检查的断面" aria-label="一键删除错误断面">
                      <Trash2 size={16} /> 一键删除
                    </button>
                    <button type="button" className={styles.outlineButton} onClick={onExportSections} title="导出断面样例" aria-label="导出断面样例">
                      <Download size={16} /> 导出断面样例
                    </button>
                    <button type="button" className={`${styles.outlineButton} ${isFixingShoreLineReversed ? styles.active : ''}`} onClick={toggleFixShoreLineReversed} disabled={!uploadedData || selectedLinesSize === 0} title="修正选择" aria-label="修正选择">
                      <MousePointer2 size={16} /> 修正选择
                    </button>
                    <button type="button" className={styles.outlineButton} onClick={sendSelectedShoreLinesGeoJson} title="上传岸段" aria-label="上传岸段">
                      <Upload size={16} /> 上传岸段
                    </button>
                  </div>
                </div>
              )}

          </div>
        </section>

        {/* 参数配置 */}
        <section className={styles.configSection} data-tour="param-config">
          <div className={styles.sectionTitle}>
            <Settings size={14} /> 参数配置
          </div>
          <div className={styles.card}>
            <div className={styles.inputGroup}>
              <label>参数模板:</label>
              <select
                value={selectedBasicParamIdState ?? ''}
                onChange={(e) => handleSelectBasicParam(e.target.value || null)}
              >
                <option value="">（不使用模板）</option>
                {basicParamsList.map((p: any, idx: number) => {
                  const paramId = p.param_id ?? p.id ?? idx;
                  const name = p.param_name || p.paramName || String(paramId);
                  return (
                    <option key={String(paramId)} value={String(paramId)}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </div>
            <button type="button" className={styles.primaryButton} onClick={openGlobalPropertiesModal} title="编辑全局属性" aria-label="全局属性配置" style={{ width: '100%' }}>
              <Settings size={14} /> 模板属性配置
            </button>
          </div>
        </section>

        {/* 截取岸段 */}
        <section className={styles.configSection}>
          <div className={styles.sectionTitle}>
            <Activity size={14} /> 截取岸段
          </div>
          <div className={styles.card}>
            <button
              type="button"
              className={`${styles.outlineButton} ${isSelectingStartEnd ? styles.active : ''} ${styles.fullWidth}`}
              onClick={toggleStartEndSelection}
            >
              <MousePointer2 size={16} /> 
              {isSelectingStartEnd ? '正在接收点击' : '拾取位置截取岸段'}
            </button>
            {isSelectingStartEnd && (
              <div className={styles.mt8}>
                <p className={styles.hintText}>先在底图岸段上点击起点，再点击终点，自动截取</p>
                <button type="button" className={styles.outlineButton} onClick={onClipBank} style={{ width: '100%' }}>
                  <Check size={14} /> 确认截取
                </button>
              </div>
            )}

            {clippedBanks && clippedBanks.length > 0 && (
              <div className={`${styles.inputGroup} ${styles.mt12}`}>
                <div className={styles.bankSelectHeader}>
                  <span className={styles.bankSelectLabel}>已截取岸段:</span>
                  <span className={styles.bankSelectCount}>{clippedBanks.length}</span>
                </div>
                <div className={styles.loadedBanksList}>
                  {clippedBanks.map((bank: any) => {
                    const bankId = String(bank.bank_id);
                    const bankName = bank.bank_name || bankId;
                    const isLoaded = loadedBanks && loadedBanks.some((lb: any) => String(lb.bank_id) === bankId);
                    return (
                      <div
                        key={bankId}
                        className={`${styles.loadedBankItem} ${isLoaded ? styles.selected : ''}`}
                        onClick={() => loadBankById?.(bankId)}
                        title={isLoaded ? '已加载到地图' : '点击加载到地图'}
                      >
                        <div className={styles.loadedBankItemMain}>
                          <span className={styles.loadedBankItemName}>{bankName}</span>
                          <span className={styles.loadedBankItemId}>{bankId}</span>
                        </div>
                        <button
                          className={styles.bankParamsBtn}
                          onClick={(e) => { e.stopPropagation(); deleteBankById?.(bankId); }}
                          title="删除截取岸段"
                        ><Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 断面编辑 */}
        <section className={styles.configSection}>
          <div className={styles.sectionTitle}>
            <Layout size={14} /> 断面精细调整
          </div>
          <div className={styles.card}>
            <button
              type="button"
              className={`${styles.outlineButton} ${isSelectingCrossLines ? styles.active : ''} ${styles.fullWidth}`}
              onClick={toggleCrossLineSelection}
              data-tour="fine-tune"
            >
              {isSelectingCrossLines ? '退出精调' : '进入精调'}
            </button>

            {isSelectingCrossLines && (
              <>
                <span className={styles.modeLabel}>调整已有断面</span>
                <div className={styles.buttonGrid}>
                  <button
                    type="button"
                    className={`${styles.outlineButton} ${crossLineEditMode === 'select' && crossLineControlMode === 'shoreline' ? styles.active : ''}`}
                    onClick={() => { setCrossLineEditMode('select'); setCrossLineControlMode('shoreline'); }}
                    title="沿线约束：选中断面后沿岸段线平移，保持垂直"
                    aria-label="沿线约束调整"
                  >
                    <MoveHorizontal size={14} /> 沿线约束
                  </button>
                  <button
                    type="button"
                    className={`${styles.outlineButton} ${crossLineEditMode === 'select' && crossLineControlMode === 'free' ? styles.active : ''}`}
                    onClick={() => { setCrossLineEditMode('select'); setCrossLineControlMode('free'); }}
                    title="自由拖动：选中断面后可拖拽移动、旋转、缩放"
                    aria-label="自由拖动调整"
                  >
                    <Move size={14} /> 自由拖动
                  </button>
                </div>

                <span className={styles.modeLabel}>新建断面</span>
                <div className={styles.buttonGrid}>
                  <button
                    type="button"
                    className={`${styles.outlineButton} ${crossLineEditMode === 'add' && crossLineControlMode === 'shoreline' ? styles.active : ''}`}
                    onClick={() => { setCrossLineEditMode('add'); setCrossLineControlMode('shoreline'); }}
                    title="按垂线生成：点击岸段线，在点击位置生成垂直断面"
                    aria-label="按垂线生成断面"
                  >
                    <Plus size={14} /> 按垂线生成
                  </button>
                  <button
                    type="button"
                    className={`${styles.outlineButton} ${crossLineEditMode === 'add' && crossLineControlMode === 'free' ? styles.active : ''}`}
                    onClick={() => { setCrossLineEditMode('add'); setCrossLineControlMode('free'); }}
                    title="自由创建：点击地图上两点，自由绘制断面"
                    aria-label="自由创建断面"
                  >
                    <Plus size={14} /> 自由创建
                  </button>
                </div>

                {selectedCrossLineIndex !== null && (
                  <div className={styles.borderTopCard}>
                    <div className={`${styles.flexBetween}`}>
                      <span className={styles.crossTitle}>断面 #{selectedCrossLineIndex + 1}</span>
                      <button type="button" onClick={deleteSelectedCrossLine} className={styles.dangerTextButton} title="删除断面" aria-label={`删除断面 ${selectedCrossLineIndex + 1}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {crossLineControlMode === 'shoreline' && (
                      <>
                        <span className={styles.modeLabel}>沿线平移</span>
                        <div className={styles.buttonGrid}>
                          <button type="button" onClick={() => translateSelectedCrossLine(-5)} className={`${styles.outlineButton} ${styles.smallPad}`}>-5m</button>
                          <button type="button" onClick={() => translateSelectedCrossLine(-1)} className={`${styles.outlineButton} ${styles.smallPad}`}>-1m</button>
                          <button type="button" onClick={() => translateSelectedCrossLine(1)} className={`${styles.outlineButton} ${styles.smallPad}`}>+1m</button>
                          <button type="button" onClick={() => translateSelectedCrossLine(5)} className={`${styles.outlineButton} ${styles.smallPad}`}>+5m</button>
                        </div>
                      </>
                    )}

                    <span className={styles.modeLabel}>旋转</span>
                    <div className={styles.buttonGrid}>
                      <button type="button" onClick={() => rotateSelectedCrossLine(-5)} className={`${styles.outlineButton} ${styles.smallPad}`} title="逆时针旋转 5°" aria-label="逆时针旋转">-5°</button>
                      <button type="button" onClick={() => rotateSelectedCrossLine(5)} className={`${styles.outlineButton} ${styles.smallPad}`} title="顺时针旋转 5°" aria-label="顺时针旋转">+5°</button>
                    </div>
                    <span className={styles.modeLabel}>缩放</span>
                    <div className={styles.buttonGrid}>
                      <button type="button" onClick={() => scaleSelectedCrossLine(-10)} className={`${styles.outlineButton} ${styles.smallPad}`} title="缩短 10m" aria-label="缩短">-10m</button>
                      <button type="button" onClick={() => scaleSelectedCrossLine(10)} className={`${styles.outlineButton} ${styles.smallPad}`} title="拉长 10m" aria-label="拉长">+10m</button>
                    </div>

                    <span className={styles.modeLabel}>其他</span>
                    <div className={styles.buttonGrid}>
                      <button type="button" onClick={reverseSelectedCrossLine} className={styles.outlineButton} title="反转方向" aria-label="反转断面方向">
                        <RotateCw size={14} /> 反切
                      </button>
                      <button type="button" onClick={configureSelectedCrossLineProperties} className={styles.outlineButton} title="断面属性" aria-label="断面属性">
                        <Settings size={14} /> 属性
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* 视图控制工具 */}
        <section className={styles.configSection}>
          <div className={styles.sectionTitle}>
            <Settings size={14} /> 视图与工具
          </div>
          <div className={styles.card}>
          <div className={styles.buttonGrid}>
            <button type="button" className={styles.outlineButton} onClick={() => setShowCrossLines(!showCrossLines)} title={showCrossLines ? '隐藏设计' : '显示设计'} aria-label={showCrossLines ? '隐藏设计' : '显示设计'}>
              {showCrossLines ? <EyeOff size={16} /> : <Eye size={16} />} 
              {showCrossLines ? '隐藏设计' : '显示设计'}
            </button>
            <button type="button" className={styles.outlineButton} onClick={() => setShowTiffBounds(!showTiffBounds)} title={showTiffBounds ? '隐藏 TIF 范围' : '显示 TIF 范围'} aria-label={showTiffBounds ? '隐藏 TIF 范围' : '显示 TIF 范围'}>
              <Layers size={16} /> {showTiffBounds ? '隐藏 TIF 范围' : '显示 TIF 范围'}
            </button>
            <button type="button" className={`${styles.outlineButton} ${colorBanks ? styles.active : ''}`} onClick={() => setColorBanks?.(!colorBanks)} title="区分岸段颜色">
              <Eye size={14} /> 岸段着色
            </button>
            <button type="button" className={styles.outlineButton} onClick={onClear} title="清空" aria-label="清空">
              <Eraser size={16} /> 清空
            </button>
          </div>
          </div>
        </section>
      </div>

      <div className={styles.sidebarFooter}>
        <button
          type="button"
          className={styles.analysisButton}
          onClick={handleStartAnalysis}
          disabled={!perpendicularData || perpendicularData.features.length === 0}
          title="执行岸线分析"
          aria-label="执行岸线分析"
        >
          <Zap size={28} />
        </button>
        <span className={styles.hintText}>执行风险分析</span>
      </div>
    </div>
  );
}

export default EditorSidebar;
