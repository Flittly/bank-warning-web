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
  Layout,
  Download
} from 'lucide-react';
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
  handleStartAnalysis: () => void;
  onClear: () => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSectionsFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSelectBasicParam: (id: string | null) => void;
  onExportSections: () => void;
}

function EditorSidebar(props: EditorSidebarProps) {
  const {
    uploadedData,
    bankGroups,
    selectedBankGroup,
    setSelectedBankGroup,
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
    handleStartAnalysis,
    onClear,
    handleFileUpload,
    handleSectionsFileUpload,
    handleSelectBasicParam,
    onExportSections,
    loadedBanks,
    selectedLoadedBanks,
    setSelectedLoadedBanks,
    deleteLoadedBanks,
  } = props;

  const activeSelectedBank = selectedBankGroup[selectedBankGroup.length - 1] || '';

  return (
    <div className={styles.sidebarContainer}>
      <div className={styles.sidebarHeader}>
        <h2>断面设计</h2>
      </div>

      <div className={styles.sidebarContent}>
        {/* 数据加载 */}
        <section className={styles.configSection}>
          <div className={styles.sectionTitle}>
            <Upload size={14} /> 数据加载与配置
          </div>
          <div className={styles.card}>
            <div className={styles.buttonGrid}>
              <label className={styles.primaryButton}>
                <Upload size={16} /> 上传岸段
                <input
                  type="file"
                  className={styles.fileInput}
                  accept=".geojson,application/json"
                  onChange={handleFileUpload}
                />
              </label>
              <label className={styles.outlineButton}>
                <Upload size={16} /> 上传断面
                <input
                  type="file"
                  className={styles.fileInput}
                  accept=".geojson,application/json"
                  onChange={handleSectionsFileUpload}
                />
              </label>
            </div>

            <div className={`${styles.inputGroup} ${styles.bankSelectGroup}`}>
              <div className={styles.bankSelectHeader}>
                <span className={styles.bankSelectLabel}>获取岸段:</span>
                {selectedBankGroup.length > 0 && (
                  <span className={styles.bankSelectCount}>已选 {selectedBankGroup.length} 条</span>
                )}
              </div>
              <select
                className={styles.bankSelect}
                multiple
                value={selectedBankGroup}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions)
                    .map((o) => o.value)
                    .filter((v) => v);
                  setSelectedBankGroup(values);
                }}
              >
                {/* 优先显示按 bank_id 列表 */}
                {bankList && bankList.length > 0
                  ? bankList.map((b) => (
                      <option key={String(b.bank_id)} value={String(b.bank_id)}>
                        岸段: {String(b.bank_id)}
                      </option>
                    ))
                  : bankGroups.map((g) => (
                      <option key={g.region_code} value={g.region_code}>
                        {g.region_code}（{g.count} 条）
                      </option>
                    ))}
              </select>
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

            {perpendicularData && perpendicularData.features.length > 0 && (
              <div className={styles.mt12}>
                <button
                  type="button"
                  className={styles.outlineButton}
                  onClick={validateAllPendingSections}
                  title="强制重新校验全部断面（接口 500 时可重试；用于编辑移动后刷新状态）"
                  aria-label="断面检查"
                >
                  <CheckCircle2 size={16} /> 断面检查
                </button>
              </div>
            )}

            {perpendicularData && perpendicularData.features.length > 0 && (
              <div className={styles.mt12}>
                <button
                  type="button"
                  className={styles.outlineButton}
                  onClick={() => {
                    void deleteAllInvalidSections();
                  }}
                  title="一键删除所有未通过检查的断面（仅保留未验证与已通过）"
                  aria-label="一键删除错误断面"
                >
                  <Trash2 size={16} /> 一键删除
                </button>
              </div>
            )}

            {perpendicularData && perpendicularData.features.length > 0 && (
              <div className={styles.mt12}>
                <button type="button" className={styles.outlineButton} onClick={onExportSections} title="导出断面样例" aria-label="导出断面样例">
                  <Download size={16} /> 导出断面样例
                </button>
              </div>
            )}

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
            <Layers size={14} /> 岸段与断面规则
          </div>
          <div className={styles.card}>
            <div className={styles.inputGroup}>
              <label>断面间距 (m):</label>
              <input
                type="number"
                value={globalInterval}
                onChange={(e) => setGlobalInterval(Number(e.target.value))}
                min="10"
                step="10"
              />
            </div>
            <div className={styles.inputGroup}>
              <label>断面长度 (m):</label>
              <input
                type="number"
                value={globalLength}
                onChange={(e) => setGlobalLength(Number(e.target.value))}
                min="100"
                step="100"
              />
            </div>
            
            <div className={styles.buttonGrid}>
              <button
                type="button"
                className={`${styles.outlineButton} ${isSelectingShoreLines ? styles.active : ''}`}
                onClick={toggleShoreLineSelection}
              >
                {isSelectingShoreLines ? <Check size={16} /> : <MousePointer2 size={16} />}
                {isSelectingShoreLines ? '选择中' : '拾取岸段'}
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

            <div className={styles.mt12}>
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
                <div className={styles.buttonGrid}>
                  <button
                    type="button"
                    className={`${styles.outlineButton} ${isFixingShoreLineReversed ? styles.active : ''}`}
                    onClick={toggleFixShoreLineReversed}
                    title="开启岸段修正：仅对已选岸段点击生效；每次点击岸段都会反转该岸段上全部断面并同步后端，同时切换岸段 properties.reversed（true/false）"
                    aria-label="修正选择"
                    disabled={!uploadedData || selectedLinesSize === 0}
                  >
                    <MousePointer2 size={16} /> 修正选择
                  </button>
                  <button
                    type="button"
                    className={styles.outlineButton}
                    onClick={sendSelectedShoreLinesGeoJson}
                    title="发送已选岸段 GeoJSON（含修正后的 reversed 标记）到后端"
                    aria-label="发送"
                    disabled={!uploadedData || selectedLinesSize === 0}
                  >
                    <Upload size={16} /> 上传岸段
                  </button>
                </div>
              </div>
            )}

            <div className={styles.mt12}>
              <button type="button" className={styles.outlineButton} onClick={openGlobalPropertiesModal} title="先选择参数模板，再编辑全局属性" aria-label="全局属性配置">
                <Settings size={14} /> 模板属性配置
              </button>
            </div>
          </div>
        </section>

        {/* 起止点选择 */}
        <section className={styles.configSection}>
          <div className={styles.sectionTitle}>
            <Activity size={14} /> 段落起止控制
          </div>
          <div className={styles.card}>
            <button
              type="button"
              className={`${styles.outlineButton} ${isSelectingStartEnd ? styles.active : ''} ${styles.fullWidth}`}
              onClick={toggleStartEndSelection}
            >
              <MousePointer2 size={16} /> 
              {isSelectingStartEnd ? '正在接收点击' : '拾取段落位置'}
            </button>
            
            {groups.length > 0 && (
              <div className={styles.mt12}>
                {groups.map((g, idx) => (
                  <div key={g.id} className={styles.groupItem}>
                    <div className={styles.groupHeader} onClick={() => handleEditGroup(g.id)}>
                      <span className={styles.groupHeaderTitle}>
                        段落 {idx + 1}: {g.end === null ? '等点终点' : `${g.start.toFixed(0)}m - ${g.end.toFixed(0)}m`}
                      </span>
                      {editingGroupId === g.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>
                    {editingGroupId === g.id && (
                      <div className={styles.groupConfig}>
                        <div className={styles.inputGroup}>
                          <label>间距 (m):</label>
                          <input
                            type="number"
                            value={g.interval}
                            onChange={(e) => updateGroupConfig(g.id, 'interval', Number(e.target.value))}
                          />
                        </div>
                        <div className={styles.inputGroup}>
                          <label>长度 (m):</label>
                          <input
                            type="number"
                            value={g.length}
                            onChange={(e) => updateGroupConfig(g.id, 'length', Number(e.target.value))}
                          />
                        </div>
                        <div className={styles.buttonGrid}>
                          <button
                            type="button"
                            className={styles.outlineButton}
                            onClick={() => setEditingPropertiesGroupId(g.id)}
                          >
                            <Settings size={14} /> 属性
                          </button>
                          <button
                            type="button"
                            className={styles.outlineButton}
                            onClick={() => reverseCrossLinesInGroup(g.id)}
                            disabled={!perpendicularData || perpendicularData.features.length === 0 || g.end === null}
                            title={g.end === null ? '请先拾取终点' : '反切该段落范围内的所有断面'}
                            aria-label={`反切第 ${idx + 1} 段断面方向`}
                          >
                            <RotateCw size={14} /> 反切
                          </button>
                          <button
                            type="button"
                            className={styles.outlineButton}
                            onClick={() => deleteCrossLinesInGroup(g.id)}
                            disabled={!perpendicularData || perpendicularData.features.length === 0 || g.end === null}
                            title={g.end === null ? '请先拾取终点' : '删除该段落范围内的所有断面'}
                            aria-label={`删除第 ${idx + 1} 段断面`}
                          >
                            <Trash2 size={14} /> 删除
                          </button>
                          <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={handleApplyCustomSegments}
                          >
                            <Check size={14} /> 应用
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteGroup(g.id)}
                          className={styles.dangerTextButton}
                          title="删除此段"
                          aria-label={`删除第 ${idx + 1} 段`}
                        >
                          删除此段
                        </button>
                      </div>
                    )}
                  </div>
                ))}
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
            >
              {isSelectingCrossLines ? '完成编辑' : '开启断面精调'}
            </button>

            

            {isSelectingCrossLines && (
              <>
                <div className={styles.buttonGrid}>
                  <button
                    type="button"
                    className={`${styles.outlineButton} ${crossLineControlMode === 'shoreline' ? styles.active : ''}`}
                    onClick={() => setCrossLineControlMode('shoreline')}
                    title="沿岸段线模式：点击岸段生成断面，按钮平移按距离沿岸线移动"
                    aria-label="岸段线模式"
                  >
                    岸段线
                  </button>
                  <button
                    type="button"
                    className={`${styles.outlineButton} ${crossLineControlMode === 'free' ? styles.active : ''}`}
                    onClick={() => setCrossLineControlMode('free')}
                    title="自由模式：可拖动断面，旋转/缩放，并点选起止点创建断面"
                    aria-label="自由模式"
                  >
                    自由
                  </button>
                </div>

                <div className={styles.buttonGrid}>
                  <button
                    type="button"
                    className={`${styles.outlineButton} ${crossLineEditMode === 'select' ? styles.active : ''}`}
                    onClick={() => {
                      if (crossLineEditMode === 'select') {
                        setCrossLineEditMode('none');
                        clearSelectedCrossLineSelection();
                      } else {
                        setCrossLineEditMode('select');
                      }
                    }}
                  >
                    选择
                  </button>
                  <button
                    type="button"
                    className={`${styles.outlineButton} ${crossLineEditMode === 'add' ? styles.active : ''}`}
                    onClick={() => setCrossLineEditMode('add')}
                  >
                    <Plus size={14} /> 添加
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

                    {crossLineControlMode === 'shoreline' ? (
                      <div className={styles.buttonGrid}>
                        <button type="button" onClick={() => translateSelectedCrossLine(-5)} className={`${styles.outlineButton} ${styles.smallPad}`}>-5m</button>
                        <button type="button" onClick={() => translateSelectedCrossLine(-1)} className={`${styles.outlineButton} ${styles.smallPad}`}>-1m</button>
                        <button type="button" onClick={() => translateSelectedCrossLine(1)} className={`${styles.outlineButton} ${styles.smallPad}`}>+1m</button>
                        <button type="button" onClick={() => translateSelectedCrossLine(5)} className={`${styles.outlineButton} ${styles.smallPad}`}>+5m</button>
                      </div>
                    ) : (
                      <>
                        <div className={styles.buttonGrid}>
                          <button type="button" onClick={() => rotateSelectedCrossLine(-5)} className={`${styles.outlineButton} ${styles.smallPad}`} title="逆时针旋转 5°" aria-label="逆时针旋转">-5°</button>
                          <button type="button" onClick={() => rotateSelectedCrossLine(5)} className={`${styles.outlineButton} ${styles.smallPad}`} title="顺时针旋转 5°" aria-label="顺时针旋转">+5°</button>
                          <button type="button" onClick={() => scaleSelectedCrossLine(-10)} className={`${styles.outlineButton} ${styles.smallPad}`} title="缩短 10m" aria-label="缩短">-10m</button>
                          <button type="button" onClick={() => scaleSelectedCrossLine(10)} className={`${styles.outlineButton} ${styles.smallPad}`} title="拉长 10m" aria-label="拉长">+10m</button>
                        </div>
                      </>
                    )}

                    <div className={`${styles.buttonGrid} ${styles.mt8}`}>
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
          <div className={styles.buttonGrid}>
            <button type="button" className={styles.outlineButton} onClick={() => setShowCrossLines(!showCrossLines)} title={showCrossLines ? '隐藏设计' : '显示设计'} aria-label={showCrossLines ? '隐藏设计' : '显示设计'}>
              {showCrossLines ? <EyeOff size={16} /> : <Eye size={16} />} 
              {showCrossLines ? '隐藏设计' : '显示设计'}
            </button>
            <button type="button" className={styles.outlineButton} onClick={onClear} title="清空" aria-label="清空">
              <Eraser size={16} /> 清空
            </button>
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
          <Zap size={18} /> 执行岸线分析
        </button>
      </div>
    </div>
  );
}

export default EditorSidebar;
