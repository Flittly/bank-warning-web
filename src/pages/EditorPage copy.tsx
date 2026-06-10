import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../App.css';

// 设置Mapbox访问令牌
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// 分析配置默认值
const ANALYSIS_CONFIG_DEFAULT = {
  "bench-id": "tiff/Mzs/2012/standard/201210/201210.tif",
  "ref-id": "tiff/Mzs/2023/standard/202304/202304.tif",
  "dem-id": "tiff/Mzs/2023/standard/202304/202304.tif",
  "current-timepoint": "2024-01-15",
  "comparison-timepoint": "2020-01-15",
  "segment": "Mzs",
  "year": "2023",
  "set": "standard",
  "water-qs": "45000",
  "tidal-level": "zc",
  "hs": 0.5,
  "hc": 2,
  "protection-level": "systemic",
  "control-level": "strict",
  "risk-thresholds": {
    "Zb": [20, 30, 40],
    "Sa": [0.2, 0.3, 0.5],
    "Ln": [0.04, 0.12, 0.2],
    "PQ": [0.5, 1, 2.3],
    "Ky": [1.7, 1.35, 1],
    "Zd": [0.1, 0.15, 0.3],
    "Dsed": [0.7, 1, 1.5],
    "all": [0.25, 0.5, 0.75]
  },
  "wNM": [0.43, 0.32, 0.25],
  "wRE": [0.48, 0.16, 0.36],
  "wGE": [0.6, 0.2, 0.2],
  "wRL": [0.32, 0.43, 0.25]
};

/**
 * 在线上以固定间距生成垂线
 * @param line 主线
 * @param startDist 起点距离 (米)
 * @param endDist 终点距离 (米)
 * @param interval 间距 (米)
 * @param crossLength 垂线总长度 (米)
 */
function generatePerpendicularLines(
  line: GeoJSON.Feature<GeoJSON.LineString>,
  startDist: number,
  endDist: number,
  interval: number,
  crossLength: number
) {
  const perpendicularLines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  const endpointData: { distance: number; left: number[]; right: number[] }[] = [];

  // 确保 start < end
  const actualStart = Math.min(startDist, endDist);
  const actualEnd = Math.max(startDist, endDist);
  const lineLength = turf.length(line, { units: 'meters' });
  const segmentLen = actualEnd - actualStart;

  console.log(`--- 生成垂线数据 (范围: ${actualStart.toFixed(2)}m - ${actualEnd.toFixed(2)}m, 段长: ${segmentLen.toFixed(2)}m, 母线总长: ${lineLength.toFixed(2)}m) ---`);

  for (let d = actualStart; d <= actualEnd; d += interval) {
    const p1 = turf.along(line, d, { units: 'meters' });
    // 为了计算切线方向
    const p2Offset = Math.min(d + 0.1, lineLength);
    const p2 = turf.along(line, p2Offset, { units: 'meters' });

    const relPos = segmentLen > 0 ? (d - actualStart) / segmentLen : 0;
    console.log(`垂线位置: ${d.toFixed(2)}m, 整线归一化: ${(d / lineLength).toFixed(4)}, 区段内归一化: ${relPos.toFixed(4)}`);

    let bearing = 0;
    if (d >= lineLength - 0.1) {
      const pPrev = turf.along(line, Math.max(0, d - 0.1), { units: 'meters' });
      bearing = turf.bearing(pPrev, p1);
    } else {
      bearing = turf.bearing(p1, p2);
    }

    const leftEnd = turf.destination(p1, crossLength / 2, bearing - 90, { units: 'meters' });
    const rightEnd = turf.destination(p1, crossLength / 2, bearing + 90, { units: 'meters' });

    const leftCoords = leftEnd.geometry.coordinates;
    const rightCoords = rightEnd.geometry.coordinates;

    endpointData.push({
      distance: d,
      left: leftCoords,
      right: rightCoords
    });

    perpendicularLines.push({
      type: 'Feature',
      properties: {
        distance: d,
        leftPoint: leftCoords,
        rightPoint: rightCoords
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          leftCoords,
          rightCoords
        ]
      }
    });
  }

  return {
    featureCollection: turf.featureCollection(perpendicularLines),
    endpointData
  };
}

// 定义选择组接口
interface SelectionGroup {
  id: string;
  line: GeoJSON.Feature<GeoJSON.LineString>;
  lineIndex: number | undefined; // 线在上传数据中的索引，用于判断是否同一条线
  start: number;
  end: number | null;
  interval: number;
  // 上一次实际应用到垂线上的间距，用于判断用户是否修改了间距
  lastAppliedInterval: number;
  length: number;
  crossData: { distance: number; left: number[]; right: number[] }[];
  // 该组的属性配置（如果未设置则使用全局配置）
  properties?: Partial<typeof ANALYSIS_CONFIG_DEFAULT>;
}

/**
 * 将垂线数据发送到后端进行分析
 * @param crossData 垂线端点数据数组
 * @param groupId 组ID（用于日志）
 * @param taskUid 任务的唯一标识符
 */
async function sendCrossLinesToBackend(
  crossData: { distance: number; left: number[]; right: number[]; analysisConfig?: typeof ANALYSIS_CONFIG_DEFAULT }[],
  groupId: string,
  taskUid: string
) {
  console.log(`开始向后端发送组 ${groupId} 的 ${crossData.length} 条垂线数据...`);
  console.log(`任务UID: ${taskUid}`);

  try {
    const promises = crossData.map(async (item, index) => {
      // 为每条断面生成唯一的uid
      const sectionUid = `crossline-${Date.now()}-${index + 1}`;
      
      const payload = {
        uid: sectionUid,
        ...(item.analysisConfig || ANALYSIS_CONFIG_DEFAULT),
        "section-geometry": {
          "type": "Feature",
          "properties": { "distance": item.distance, "index": index },
          "geometry": { 
            "type": "LineString", 
            "coordinates": [item.left, item.right] 
          }
        }
      };

      console.log(`正在发送垂线 ${index + 1}/${crossData.length} (距离: ${item.distance.toFixed(2)}m, UID: ${sectionUid}):`, payload);

      const response = await fetch('http://192.168.1.102:8088/v0/mi/risk-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`垂线 ${index + 1}/${crossData.length} (距离: ${item.distance.toFixed(2)}m, UID: ${sectionUid}) 已发送`);
      return result;
    });

    const results = await Promise.all(promises);
    console.log(`组 ${groupId} 的所有垂线数据已成功发送到后端`);
    return results;
  } catch (error) {
    console.error(`发送组 ${groupId} 的垂线数据时出错:`, error);
    throw error;
  }
}

function EditorPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // 上传的 GeoJSON 数据 (主线)
  const [uploadedData, setUploadedData] = useState<GeoJSON.FeatureCollection | null>(null);
  // 上传的 GeoJSON 文件名
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  // 生成的垂线数据
  const [perpendicularData, setPerpendicularData] = useState<GeoJSON.FeatureCollection | null>(null);
  const perpendicularDataRef = useRef(perpendicularData);
  useEffect(() => { perpendicularDataRef.current = perpendicularData; }, [perpendicularData]);

  // 所有选择组
  const [groups, setGroups] = useState<SelectionGroup[]>([]);
  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  // 全局垂线配置（用于首次绘制整个 GeoJSON）
  const [globalInterval, setGlobalInterval] = useState<number>(100);
  const [globalLength, setGlobalLength] = useState<number>(2000);
  
  // 当前正在编辑的组ID
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  
  const [showCrossLines, setShowCrossLines] = useState<boolean>(true);
  
  // 全局属性配置
  const [globalProperties, setGlobalProperties] = useState(ANALYSIS_CONFIG_DEFAULT);
  // 属性配置弹窗状态
  const [showGlobalPropertiesModal, setShowGlobalPropertiesModal] = useState<boolean>(false);
  const [editingPropertiesGroupId, setEditingPropertiesGroupId] = useState<string | null>(null);
  
  // 新增状态：控制岸段选择模式
  const [isSelectingShoreLines, setIsSelectingShoreLines] = useState<boolean>(false);
  const isSelectingShoreLinesRef = useRef(isSelectingShoreLines);
  useEffect(() => { isSelectingShoreLinesRef.current = isSelectingShoreLines; }, [isSelectingShoreLines]);
  
  // 新增状态：控制起止点选择模式
  const [isSelectingStartEnd, setIsSelectingStartEnd] = useState<boolean>(false);
  const isSelectingStartEndRef = useRef(isSelectingStartEnd);
  useEffect(() => { isSelectingStartEndRef.current = isSelectingStartEnd; }, [isSelectingStartEnd]);
  
  // 新增状态：选中的用于生成垂线的线段（存储线的唯一标识）
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const selectedLinesRef = useRef(selectedLines);
  useEffect(() => { selectedLinesRef.current = selectedLines; }, [selectedLines]);
  
  // 新增状态：控制断面选择模式
  const [isSelectingCrossLines, setIsSelectingCrossLines] = useState<boolean>(false);
  const isSelectingCrossLinesRef = useRef(isSelectingCrossLines);
  useEffect(() => { isSelectingCrossLinesRef.current = isSelectingCrossLines; }, [isSelectingCrossLines]);
  
  // 新增状态：选中的断面索引
  const [selectedCrossLineIndex, setSelectedCrossLineIndex] = useState<number | null>(null);
  const selectedCrossLineIndexRef = useRef(selectedCrossLineIndex);
  useEffect(() => { selectedCrossLineIndexRef.current = selectedCrossLineIndex; }, [selectedCrossLineIndex]);
  
  // 新增状态：拖拽相关
  const [isDraggingCrossLine, setIsDraggingCrossLine] = useState<boolean>(false);
  const isDraggingCrossLineRef = useRef(isDraggingCrossLine);
  useEffect(() => { isDraggingCrossLineRef.current = isDraggingCrossLine; }, [isDraggingCrossLine]);

  // 使用 Ref 跟踪配置值，确保事件监听器中能获取到最新值
  const configRef = useRef({ interval: globalInterval, length: globalLength });
  useEffect(() => {
    configRef.current = { interval: globalInterval, length: globalLength };
  }, [globalInterval, globalLength]);

  // 切换岸段选择模式
  const toggleShoreLineSelection = () => {
    setIsSelectingShoreLines(!isSelectingShoreLines);
    if (isSelectingStartEnd) {
      setIsSelectingStartEnd(false); // 关闭起止点选择模式
    }
    if (isSelectingCrossLines) {
      setIsSelectingCrossLines(false); // 关闭断面选择模式
    }
  };
  
  // 全选所有岸段
  const selectAllShoreLines = () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }
    
    const allLineIds = new Set<string>();
    uploadedData.features.forEach((feature, index) => {
      if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
        allLineIds.add(`line-${index}`);
      }
    });
    
    setSelectedLines(allLineIds);
    console.log(`已全选 ${allLineIds.size} 个岸段`);
    alert(`已全选 ${allLineIds.size} 个岸段`);
  };
  
  // 切换起止点选择模式
  const toggleStartEndSelection = () => {
    setIsSelectingStartEnd(!isSelectingStartEnd);
    if (isSelectingShoreLines) {
      setIsSelectingShoreLines(false); // 关闭岸段选择模式
    }
    if (isSelectingCrossLines) {
      setIsSelectingCrossLines(false); // 关闭断面选择模式
    }
  };
  
  // 切换断面选择模式
  const toggleCrossLineSelection = () => {
    setIsSelectingCrossLines(!isSelectingCrossLines);
    if (isSelectingShoreLines) {
      setIsSelectingShoreLines(false);
    }
    if (isSelectingStartEnd) {
      setIsSelectingStartEnd(false);
    }
    if (!isSelectingCrossLines) {
      setSelectedCrossLineIndex(null); // 关闭模式时清空选择
    }
  };
  
  // 删除选中的断面
  const deleteSelectedCrossLine = () => {
    if (selectedCrossLineIndex === null || !perpendicularData) {
      alert('请先选择要删除的断面');
      return;
    }
    
    const updatedFeatures = perpendicularData.features.filter((_, index) => index !== selectedCrossLineIndex);
    // 重新分配ID
    updatedFeatures.forEach((feature, index) => {
      if (feature.properties) {
        feature.properties.crossLineId = index;
      }
    });
    setPerpendicularData(turf.featureCollection(updatedFeatures));
    setSelectedCrossLineIndex(null);
    console.log('已删除断面，剩余断面数:', updatedFeatures.length);
    alert('已删除选中的断面');
  };
  
  // 开始拖拽断面
  const startDraggingCrossLine = (index: number) => {
    console.log(`=== startDraggingCrossLine 被调用 ===`);
    console.log(`- 断面索引: ${index}`);
    console.log(`- 当前perpendicularData:`, perpendicularData);
    console.log(`- 断面总数: ${perpendicularData?.features.length}`);
    
    setSelectedCrossLineIndex(index);
    setIsDraggingCrossLine(true);
    
    console.log(`- 状态已更新: selectedCrossLineIndex=${index}, isDragging=true`);
  };
  
  // 拖拽断面到新位置
  const dragCrossLineTo = (lngLat: { lng: number; lat: number }) => {
    console.log('=== dragCrossLineTo 被调用 ===', lngLat);
    
    const currentIndex = selectedCrossLineIndexRef.current;
    const currentData = perpendicularDataRef.current;
    const isDragging = isDraggingCrossLineRef.current;
    
    console.log('dragCrossLineTo - currentIndex:', currentIndex);
    console.log('dragCrossLineTo - currentData:', currentData);
    console.log('dragCrossLineTo - isDragging:', isDragging);
    
    if (currentIndex === null || !currentData || !isDragging) {
      console.log('拖拽条件不满足:', { currentIndex, hasData: !!currentData, isDragging });
      return;
    }
    
    const selectedLine = currentData.features[currentIndex];
    console.log('dragCrossLineTo - selectedLine:', selectedLine);
    
    if (!selectedLine || selectedLine.geometry.type !== 'LineString') {
      console.log('断面不存在或类型错误');
      return;
    }
    
    const coords = selectedLine.geometry.coordinates as number[][];
    const leftPoint = coords[0];
    const rightPoint = coords[1];
    
    console.log('dragCrossLineTo - leftPoint:', leftPoint, 'rightPoint:', rightPoint);
    
    // 计算断面的原始中点
    const oldMidPoint = [(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2];
    
    // 新的中点就是鼠标位置
    const newMidPoint = [lngLat.lng, lngLat.lat];
    
    console.log('dragCrossLineTo - oldMidPoint:', oldMidPoint, 'newMidPoint:', newMidPoint);
    
    // 计算偏移量
    const offsetLng = newMidPoint[0] - oldMidPoint[0];
    const offsetLat = newMidPoint[1] - oldMidPoint[1];
    
    console.log('dragCrossLineTo - 偏移量:', offsetLng, offsetLat);
    
    // 平移两个端点
    const newLeftPoint = [leftPoint[0] + offsetLng, leftPoint[1] + offsetLat];
    const newRightPoint = [rightPoint[0] + offsetLng, rightPoint[1] + offsetLat];
    
    console.log('dragCrossLineTo - newLeftPoint:', newLeftPoint, 'newRightPoint:', newRightPoint);
    
    // 更新断面，保留crossLineId
    const updatedFeatures = [...currentData.features];
    updatedFeatures[currentIndex] = {
      ...selectedLine,
      geometry: {
        type: 'LineString',
        coordinates: [newLeftPoint, newRightPoint]
      },
      properties: {
        crossLineId: selectedLine.properties?.crossLineId ?? currentIndex,
        leftPoint: newLeftPoint,
        rightPoint: newRightPoint,
        analysisConfig: selectedLine.properties?.analysisConfig || globalProperties
      }
    };
    
    console.log('dragCrossLineTo - 准备更新状态，新features数量:', updatedFeatures.length);
    setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
    perpendicularDataRef.current = turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]);
    console.log('dragCrossLineTo - 状态已更新');
  };
  
  // 结束拖拽
  const stopDraggingCrossLine = () => {
    if (isDraggingCrossLine && selectedCrossLineIndex !== null) {
      console.log(`结束拖拽断面 #${selectedCrossLineIndex + 1}`);
    }
    setIsDraggingCrossLine(false);
  };
  
  // 为选中的断面配置属性
  const configureSelectedCrossLineProperties = () => {
    if (selectedCrossLineIndex === null || !perpendicularData) {
      alert('请先选择要配置的断面');
      return;
    }
    // 打开属性配置弹窗（使用特殊的ID标识单个断面）
    setEditingPropertiesGroupId(`cross-line-${selectedCrossLineIndex}`);
  };

  // 核心逻辑：基于上传的 GeoJSON 和全局配置生成所有垂线
  const handleGenerateSections = () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }

    if (selectedLines.size === 0) {
      alert('请先选择用于分析的岸段');
      return;
    }

    const allPerpendicularLines: GeoJSON.Feature<GeoJSON.LineString>[] = [];

    uploadedData.features.forEach((feature, index) => {
      const lineId = `line-${index}`;
      
      // 只处理选中的线段
      if (!selectedLines.has(lineId)) {
        return;
      }
      
      if (feature.geometry.type === 'LineString') {
        const line = feature as GeoJSON.Feature<GeoJSON.LineString>;
        const lineLengthMeters = turf.length(line, { units: 'meters' });
        
        const { featureCollection } = generatePerpendicularLines(
          line,
          0,
          lineLengthMeters,
          globalInterval,
          globalLength
        );
        
        allPerpendicularLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));
      } else if (feature.geometry.type === 'MultiLineString') {
        const multiLine = feature.geometry as GeoJSON.MultiLineString;
        multiLine.coordinates.forEach(coords => {
          const line = turf.lineString(coords) as GeoJSON.Feature<GeoJSON.LineString>;
          const lineLengthMeters = turf.length(line, { units: 'meters' });
          
          const { featureCollection } = generatePerpendicularLines(
            line,
            0,
            lineLengthMeters,
            globalInterval,
            globalLength
          );
          allPerpendicularLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));
        });
      }
    });

    // 简化断面数据结构：只保留必要的属性，并添加唯一ID
    allPerpendicularLines.forEach((line, index) => {
      const leftPoint = line.properties?.leftPoint;
      const rightPoint = line.properties?.rightPoint;
      line.properties = {
        crossLineId: index,
        leftPoint: leftPoint,
        rightPoint: rightPoint,
        analysisConfig: { ...globalProperties }
      };
    });

    setPerpendicularData(turf.featureCollection(allPerpendicularLines));
    setShowCrossLines(true);
    alert(`已为 ${selectedLines.size} 个岸段生成垂线！\n\n提示：可以点击"属性配置"按钮设置分析参数`);
  };

  // 开始分析：将所有垂线发送到后端
  const handleStartAnalysis = async () => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('请先绘制断面');
      return;
    }

    // 获取任务名称
    const taskName = prompt('请输入任务名称：');
    if (!taskName || taskName.trim() === '') {
      alert('任务名称不能为空');
      return;
    }

    // 生成任务UID
    const taskUid = `task-${Date.now()}`;
    
    console.log(`创建任务: ${taskName} (UID: ${taskUid})`);

    try {
      // 1. 先发送任务信息到 /task 接口
      const taskPayload = {
        uid: taskUid,
        name: taskName.trim(),
        geojson: uploadedFileName
      };
      
      console.log('向后端发送任务信息:', taskPayload);
      
      // const taskResponse = await fetch('http://192.168.1.102:8088/v0/mi/task', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(taskPayload)
      // });

      // if (!taskResponse.ok) {
      //   throw new Error(`创建任务失败: ${taskResponse.statusText}`);
      // }

      // const taskResult = await taskResponse.json();
      // console.log('任务创建成功:', taskResult);

      // 2. 收集所有垂线数据，包括每条垂线的属性配置
      const allCrossData = perpendicularData.features.map(line => ({
        distance: line.properties?.distance ?? 0,
        left: line.properties?.leftPoint as number[],
        right: line.properties?.rightPoint as number[],
        analysisConfig: line.properties?.analysisConfig as typeof ANALYSIS_CONFIG_DEFAULT
      }));

      // 3. 发送所有断面数据
      await sendCrossLinesToBackend(allCrossData, 'all-lines', taskUid);
      
      alert(`任务 "${taskName}" 创建成功！\n任务UID: ${taskUid}\n已发送 ${allCrossData.length} 条垂线到后端`);
    } catch (err) {
      alert('发送数据到后端时出错，请检查控制台');
      console.error(err);
    }
  };

  // 应用自定义线段配置：更新当前编辑组的垂线
  const handleApplyCustomSegments = () => {
    if (!editingGroupId) {
      alert('请先点击编辑按钮选择要修改的组');
      return;
    }

    const editingGroup = groups.find(g => g.id === editingGroupId);
    if (!editingGroup || editingGroup.end === null) {
      alert('选择的组未完成起止点选择');
      return;
    }

    if (!perpendicularData) {
      alert('请先绘制断面');
      return;
    }

    const start = Math.min(editingGroup.start, editingGroup.end);
    const end = Math.max(editingGroup.start, editingGroup.end);
    
    // 判断是否修改了间距：如果当前间距与上一次应用的间距不同，则认为修改了间距
    const intervalChanged = editingGroup.interval !== editingGroup.lastAppliedInterval;

    // 复制现有垂线数据
    let updatedLines = [...perpendicularData.features] as GeoJSON.Feature<GeoJSON.LineString>[];

    if (!intervalChanged) {
      // ? 未修改间距：仅根据每条垂线的位置，调整其长度，不改变位置与数量
      const newCrossData: { distance: number; left: number[]; right: number[] }[] = [];

      updatedLines = updatedLines.map(line => {
        const lineProp: any = line.properties || {};
        const leftPoint = lineProp.leftPoint as number[] | undefined;
        const rightPoint = lineProp.rightPoint as number[] | undefined;
        if (!leftPoint || !rightPoint) return line;

        try {
          // 垂线中点
          const mid = [(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2];
          const midPoint = turf.point(mid);
          // 投影到当前组的主线上，得到该垂线在主线上的实际距离
          const snapped = turf.nearestPointOnLine(editingGroup.line, midPoint, { units: 'meters' });
          const actualDist = snapped.properties.location ?? 0;
          const distToLine = turf.distance(midPoint, snapped, { units: 'meters' });

          // 过滤：只处理同一条线、并且距离在线段 [start, end] 内的垂线
          if (distToLine > Math.max(globalLength, editingGroup.length) / 2 + 100) {
            return line;
          }
          if (actualDist < start || actualDist > end) {
            return line;
          }

          // 以投影点为中心点，按旧的朝向，重新根据新的长度计算端点
          const centerPoint = snapped as GeoJSON.Feature<GeoJSON.Point>;
          const bearingToLeft = turf.bearing(centerPoint, turf.point(leftPoint));
          const halfLen = editingGroup.length / 2;

          const leftEnd = turf.destination(centerPoint, halfLen, bearingToLeft, { units: 'meters' });
          const rightEnd = turf.destination(centerPoint, halfLen, bearingToLeft + 180, { units: 'meters' });

          const newLeft = leftEnd.geometry.coordinates as number[];
          const newRight = rightEnd.geometry.coordinates as number[];

          line.geometry = {
            type: 'LineString',
            coordinates: [newLeft, newRight]
          };
          // 简化属性结构，保留原ID
          line.properties = {
            crossLineId: lineProp.crossLineId,
            leftPoint: newLeft,
            rightPoint: newRight,
            analysisConfig: editingGroup.properties || { ...globalProperties }
          };

          newCrossData.push({ distance: actualDist, left: newLeft, right: newRight });

          return line;
        } catch {
          return line;
        }
      });

      // 按距离排序 crossData，方便后续使用
      newCrossData.sort((a, b) => a.distance - b.distance);

      setGroups(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(g => g.id === editingGroup.id);
        if (idx !== -1) {
          updated[idx] = {
            ...editingGroup,
            crossData: newCrossData,
            lastAppliedInterval: editingGroup.interval
          };
        }
        return updated;
      });

      setPerpendicularData(turf.featureCollection(updatedLines));
      alert(`已更新组 ${groups.findIndex(g => g.id === editingGroupId) + 1} 的垂线长度（未修改间距）`);
    } else {
      // ? 修改了间距：删除该段原有垂线，根据新的间距与长度重新生成

      // 移除该线段范围内的旧垂线（只移除同一条线上的）
      updatedLines = updatedLines.filter(line => {
        const lineProp = line.properties as any;
        if (!lineProp) return true;
        
        const leftPoint = lineProp.leftPoint as number[] | undefined;
        const rightPoint = lineProp.rightPoint as number[] | undefined;
        if (!leftPoint || !rightPoint) return true;
        
        try {
          const midPoint = turf.point([(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2]);
          const distOnLine = turf.nearestPointOnLine(editingGroup.line, midPoint, { units: 'meters' });
          const actualDist = distOnLine.properties.location ?? 0;
          
          // 检查垂线中点是否真的在当前线上（通过距离阈值判断）
          const distToLine = turf.distance(midPoint, distOnLine, { units: 'meters' });
          
          // 如果垂线中点距离线太远，说明不是同一条线
          if (distToLine > Math.max(globalLength, editingGroup.length) / 2 + 100) {
            return true; // 保留，不是同一条线
          }
          
          // 是同一条线，检查是否在选择范围内
          if (actualDist >= start && actualDist <= end) {
            return false; // 移除，在范围内
          }
          
          return true; // 保留，不在范围内
        } catch {
          return true; // 出错则保留
        }
      });
      
      // 生成新的垂线数据
      const { featureCollection, endpointData } = generatePerpendicularLines(
        editingGroup.line,
        start,
        end,
        editingGroup.interval,
        editingGroup.length
      );
      
      // 简化垂线属性结构，添加新ID
      const startId = updatedLines.length;
      featureCollection.features.forEach((line, idx) => {
        const leftPoint = line.properties?.leftPoint;
        const rightPoint = line.properties?.rightPoint;
        line.properties = {
          crossLineId: startId + idx,
          leftPoint: leftPoint,
          rightPoint: rightPoint,
          analysisConfig: editingGroup.properties || { ...globalProperties }
        };
      });
      
      // 更新组的 crossData 与 lastAppliedInterval
      setGroups(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(g => g.id === editingGroup.id);
        if (idx !== -1) {
          updated[idx] = {
            ...editingGroup,
            crossData: endpointData,
            lastAppliedInterval: editingGroup.interval
          };
        }
        return updated;
      });
      
      // 合并新垂线
      updatedLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));

      setPerpendicularData(turf.featureCollection(updatedLines));
      alert(`已应用组 ${groups.findIndex(g => g.id === editingGroupId) + 1} 的自定义配置（修改了间距，已重绘）`);
    }
  };

  // 处理文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const geojson = json.type === 'FeatureCollection' ? json : turf.featureCollection([json]);
        
        // 为每个要素添加索引属性
        geojson.features.forEach((feature: any, index: number) => {
          if (!feature.properties) {
            feature.properties = {};
          }
          feature.properties.index = index;
        });
        
        // 保存文件名
        setUploadedFileName(file.name);
        
        // 发送 GeoJSON 到后端
        try {
          console.log('向后端发送 GeoJSON 文件:', file.name);
          const response = await fetch('http://192.168.1.102:8088/v0/mi/geojson', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: file.name,
              data: geojson
            })
          });

          if (!response.ok) {
            console.error('发送 GeoJSON 到后端失败:', response.statusText);
          } else {
            const result = await response.json();
            console.log('GeoJSON 已成功发送到后端:', result);
          }
        } catch (err) {
          console.error('发送 GeoJSON 到后端时出错:', err);
          // 不阻止前端加载，只是记录错误
        }
        
        setUploadedData(geojson);
        // 重置选择状态
        setSelectedLines(new Set());
        setIsSelectingShoreLines(false);
        setIsSelectingStartEnd(false);

        if (mapRef.current && geojson.features.length > 0) {
          const bbox = turf.bbox(geojson);
          mapRef.current.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 50 });
        }
      } catch (err) {
        alert('解析 GeoJSON 失败，请检查文件格式');
      }
    };
    reader.readAsText(file);
  };

  // 核心逻辑：同步垂线到地图数据源
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateMapSources = () => {
      const crossLinesSource = map.getSource('perpendicular-lines') as mapboxgl.GeoJSONSource;
      if (crossLinesSource) {
        crossLinesSource.setData(perpendicularData || turf.featureCollection([]));
      }
    };

    if (map.isStyleLoaded()) {
      updateMapSources();
    } else {
      map.once('idle', updateMapSources);
    }
  }, [perpendicularData]);

  // 同步上传的数据到地图
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !uploadedData) return;

    const updateSource = () => {
      const source = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData(uploadedData);
      }
    };

    if (map.isStyleLoaded()) {
      updateSource();
    } else {
      map.once('idle', updateSource);
    }
  }, [uploadedData]);

  // 同步选中线段的高亮显示
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !uploadedData) return;

    const updateSelectedLines = () => {
      // 创建一个新的图层来高亮选中的线段
      const selectedSource = map.getSource('selected-shore-lines') as mapboxgl.GeoJSONSource;
      if (selectedSource) {
        const selectedFeatures = uploadedData.features.filter((_, index) => 
          selectedLines.has(`line-${index}`)
        );
        selectedSource.setData(turf.featureCollection(selectedFeatures));
      }
    };

    if (map.isStyleLoaded()) {
      updateSelectedLines();
    } else {
      map.once('idle', updateSelectedLines);
    }
  }, [selectedLines, uploadedData]);

  // 同步选择组数据到地图
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateMapSources = () => {
      // 更新标记点数据源 (所有起止点)
      const pointSource = map.getSource('selection-points') as mapboxgl.GeoJSONSource;
      if (pointSource) {
        const allPoints: GeoJSON.Feature<GeoJSON.Point>[] = [];
        groups.forEach(group => {
          if (group.start !== null) {
            allPoints.push(turf.along(group.line, group.start, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
          }
          if (group.end !== null) {
            allPoints.push(turf.along(group.line, group.end, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
          }
        });
        pointSource.setData(turf.featureCollection(allPoints));
      }

      // 更新主线高亮段
      const activeLineSource = map.getSource('active-line') as mapboxgl.GeoJSONSource;
      if (activeLineSource) {
        const segments: GeoJSON.Feature<GeoJSON.LineString>[] = [];
        groups.forEach(group => {
          if (group.start !== null && group.end !== null) {
            try {
              const start = Math.min(group.start, group.end);
              const end = Math.max(group.start, group.end);
              const segment = turf.lineSliceAlong(group.line, start, end, { units: 'meters' });
              segment.properties = { groupId: group.id };
              segments.push(segment as GeoJSON.Feature<GeoJSON.LineString>);
            } catch (err) {
              console.warn('切割线段失败', err);
            }
          }
        });
        activeLineSource.setData(turf.featureCollection(segments));
      }
    };

    if (map.isStyleLoaded()) {
      updateMapSources();
    } else {
      map.once('idle', updateMapSources);
    }
  }, [groups]);

  // 控制垂线图层显影
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer('perpendicular-lines-layer')) {
      map.setLayoutProperty(
        'perpendicular-lines-layer',
        'visibility',
        showCrossLines ? 'visible' : 'none'
      );
    }
    if (map.getLayer('perpendicular-lines-hit-target')) {
      map.setLayoutProperty(
        'perpendicular-lines-hit-target',
        'visibility',
        showCrossLines ? 'visible' : 'none'
      );
    }
  }, [showCrossLines]);
  
  // 同步选中断面的高亮显示
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !perpendicularData) return;

    const updateSelectedCrossLine = () => {
      const selectedSource = map.getSource('selected-cross-line') as mapboxgl.GeoJSONSource;
      if (selectedSource) {
        if (selectedCrossLineIndex !== null && perpendicularData.features[selectedCrossLineIndex]) {
          selectedSource.setData(turf.featureCollection([perpendicularData.features[selectedCrossLineIndex]]));
        } else {
          selectedSource.setData(turf.featureCollection([]));
        }
      }
    };

    if (map.isStyleLoaded()) {
      updateSelectedCrossLine();
    } else {
      map.once('idle', updateSelectedCrossLine);
    }
  }, [selectedCrossLineIndex, perpendicularData]);

  useEffect(() => {
    if (!mapContainer.current) return;

    // 初始化地图
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v10',
      center: [119.89600633, 32.22907004],
      zoom: 7,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      // 初始化数据源
      map.addSource('perpendicular-lines', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('uploaded-data', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('selection-points', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('snap-point', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('active-line', { type: 'geojson', data: turf.featureCollection([]), lineMetrics: true });
      map.addSource('selected-shore-lines', { type: 'geojson', data: turf.featureCollection([]) });

      // 上传线的点击捕获层（透明但宽，便于点击）
      map.addLayer({
        id: 'uploaded-lines-hit-target',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-width': 30,
          'line-opacity': 0
        }
      });

      // 上传线的基础显示层
      map.addLayer({
        id: 'uploaded-lines',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#94a3b8',
          'line-width': 2
        }
      });

      // 高亮选中的岸段
      map.addLayer({
        id: 'selected-shore-lines-layer',
        type: 'line',
        source: 'selected-shore-lines',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#f59e0b',
          'line-width': 4
        }
      });

      // 高亮选中的线段
      map.addLayer({
        id: 'active-line-layer',
        type: 'line',
        source: 'active-line',
        paint: {
          'line-color': '#10b981',
          'line-width': 6
        }
      });

      // 断面点击捕获层（透明但宽）
      map.addLayer({
        id: 'perpendicular-lines-hit-target',
        type: 'line',
        source: 'perpendicular-lines',
        paint: {
          'line-width': 20,
          'line-opacity': 0
        }
      });
      
      // 断面显示层
      map.addLayer({
        id: 'perpendicular-lines-layer',
        type: 'line',
        source: 'perpendicular-lines',
        paint: { 'line-color': '#ef4444', 'line-width': 2 }
      });
      
      // 选中断面高亮层
      map.addSource('selected-cross-line', { type: 'geojson', data: turf.featureCollection([]) });
      map.addLayer({
        id: 'selected-cross-line-layer',
        type: 'line',
        source: 'selected-cross-line',
        paint: { 'line-color': '#3b82f6', 'line-width': 4 }
      });

      // 起止点标记
      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'selection-points',
        paint: {
          'circle-radius': 8,
          'circle-color': '#3b82f6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      // 渲染吸附点（鼠标靠近线时的反馈）
      map.addLayer({
        id: 'snap-point-layer',
        type: 'circle',
        source: 'snap-point',
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#3b82f6'
        }
      });

      const hitLayers = ['uploaded-lines-hit-target'];
      const crossLineHitLayers = ['perpendicular-lines-hit-target'];

      // mousedown事件：开始拖拽断面
      map.on('mousedown', crossLineHitLayers, (e) => {
        if (isSelectingCrossLinesRef.current && e.originalEvent.button === 0) {
          const crossLineFeatures = map.queryRenderedFeatures(e.point, { layers: crossLineHitLayers });
          console.log('mousedown - 查询到断面:', crossLineFeatures?.length);
          
          if (crossLineFeatures && crossLineFeatures.length > 0) {
            const clickedFeature = crossLineFeatures[0];
            const crossLineId = clickedFeature.properties?.crossLineId;
            
            console.log('mousedown - 断面ID:', crossLineId);
            
            if (crossLineId !== undefined && crossLineId !== null) {
              startDraggingCrossLine(crossLineId);
              e.preventDefault();
              console.log('mousedown - 已调用startDraggingCrossLine');
            }
          }
        }
      });
      
      // mousemove事件：拖拽断面
      map.on('mousemove', (e) => {
        const isDragging = isDraggingCrossLineRef.current;
        if (isDragging) {
          console.log('mousemove - 正在拖拽, 位置:', e.lngLat.lng, e.lngLat.lat);
          dragCrossLineTo(e.lngLat);
          e.preventDefault();
        }
      });
      
      // mouseup事件：结束拖拽
      map.on('mouseup', () => {
        if (isDraggingCrossLineRef.current) {
          stopDraggingCrossLine();
        }
      });

      // 点击事件处理（保留原有的岸段和起止点选择逻辑）
      map.on('click', (e) => {
        // 断面选择模式下跳过click事件（使用mousedown/mousemove/mouseup处理拖拽）
        if (isSelectingCrossLinesRef.current) {
          return;
        }
        
        const features = map.queryRenderedFeatures(e.point, { layers: hitLayers });
        const feature = features?.[0];
        
        if (!feature) return;

        // 构建当前点击的线要素
        const lineGeo = feature.geometry as GeoJSON.LineString;
        const lineFeature = turf.feature(lineGeo, feature.properties) as GeoJSON.Feature<GeoJSON.LineString>;
        
        // 获取线的索引作为唯一标识
        const lineIndex = feature.properties?.index;
        const lineId = lineIndex !== undefined ? `line-${lineIndex}` : `line-${Math.random()}`;

        // 模式1：选择岸段模式
        if (isSelectingShoreLinesRef.current) {
          setSelectedLines(prev => {
            const newSet = new Set(prev);
            if (newSet.has(lineId)) {
              newSet.delete(lineId);
              console.log(`取消选择岸段: ${lineId}`);
            } else {
              newSet.add(lineId);
              console.log(`选择岸段: ${lineId}`);
            }
            return newSet;
          });
          return;
        }
        
        // 模式2：选择起止点模式
        if (!isSelectingStartEndRef.current) {
          return; // 如果未开启起止点选择模式，不处理
        }

        const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
        const dist = snapped.properties.location ?? 0;
        const totalLineLength = turf.length(lineFeature, { units: 'meters' });

        const currentGroups = groupsRef.current;
        const activeIndex = currentGroups.findIndex(g => g.end === null);
        const { interval, length } = configRef.current;

        if (activeIndex === -1) {
          // 创建新组
          console.log(`[设置起点] 线索引: ${lineIndex}, 距离: ${dist.toFixed(2)}m, 整线归一化: ${(dist / totalLineLength).toFixed(4)}`);
          const newGroup: SelectionGroup = {
            id: Math.random().toString(36).substr(2, 9),
            line: lineFeature,
            lineIndex: lineIndex,
            start: dist,
            end: null,
            interval: interval,
            lastAppliedInterval: interval,
            length: length,
            crossData: []
          };
          setGroups(prev => [...prev, newGroup]);
        } else {
          // 检查正在进行的组是否在同一条线上（通过lineIndex判断）
          const activeGroup = currentGroups[activeIndex];
          const isSameLine = lineIndex !== undefined && lineIndex === activeGroup.lineIndex;

          if (isSameLine) {
            // 在同一条线上，结束该组（不立即生成垂线）
            console.log(`[设置终点] 线索引: ${lineIndex}, 距离: ${dist.toFixed(2)}m, 整线归一化: ${(dist / totalLineLength).toFixed(4)}`);
            
            setGroups(prev => {
              const updated = [...prev];
              const idx = updated.findIndex(g => g.id === activeGroup.id);
              if (idx !== -1) {
                updated[idx] = { ...activeGroup, end: dist };
              }
              return updated;
            });
          } else {
            // 在不同线上，重置起点
            console.log(`[跨线点击] 从线${activeGroup.lineIndex}跳到线${lineIndex}，重置起点: ${dist.toFixed(2)}m`);
            
            const newGroup: SelectionGroup = {
              id: Math.random().toString(36).substr(2, 9),
              line: lineFeature,
              lineIndex: lineIndex,
              start: dist,
              end: null,
              interval: interval,
              lastAppliedInterval: interval,
              length: length,
              crossData: []
            };
            
            setGroups(prev => {
              const filtered = prev.filter(g => g.end !== null);
              return [...filtered, newGroup];
            });
          }
        }
      });

      // 鼠标移动处理：实现吸附视觉反馈（只在激活模式下）
      map.on('mousemove', hitLayers, (e) => {
        // 只在选择岸段或选择起止点模式下显示吸附效果
        if (!isSelectingShoreLinesRef.current && !isSelectingStartEndRef.current) {
          return;
        }
        
        const feature = e.features?.[0];
        if (!feature) return;

        const lineGeo = feature.geometry as GeoJSON.LineString;
        const lineFeature = turf.feature(lineGeo) as GeoJSON.Feature<GeoJSON.LineString>;

        const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
        const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
        if (source) source.setData(snapped);

        map.getCanvas().style.cursor = 'pointer';
      });

      // 鼠标离开捕获区域：清空吸附点
      map.on('mouseleave', hitLayers, () => {
        const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
        if (source) source.setData(turf.featureCollection([]));

        map.getCanvas().style.cursor = '';
      });
      
      // 断面鼠标悬停效果
      map.on('mousemove', crossLineHitLayers, (e) => {
        if (isSelectingCrossLinesRef.current && !isDraggingCrossLineRef.current) {
          map.getCanvas().style.cursor = 'grab';
          
          // 显示断面中点作为视觉反馈
          const features = e.features;
          if (features && features.length > 0) {
            const feature = features[0];
            const geometry = feature.geometry as GeoJSON.LineString;
            const coords = geometry.coordinates;
            
            // 计算中点
            const midPoint = turf.point([
              (coords[0][0] + coords[1][0]) / 2,
              (coords[0][1] + coords[1][1]) / 2
            ]);
            
            const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
            if (source) source.setData(midPoint);
          }
        } else if (isDraggingCrossLineRef.current) {
          map.getCanvas().style.cursor = 'grabbing';
        }
      });
      
      map.on('mouseleave', crossLineHitLayers, () => {
        if (isSelectingCrossLinesRef.current) {
          map.getCanvas().style.cursor = '';
          
          // 清除断面中点
          const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
          if (source) source.setData(turf.featureCollection([]));
        }
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 清除所有组
  const onClear = () => {
    setGroups([]);
    setPerpendicularData(null);
    setEditingGroupId(null);
    alert('已清除所有选择');
  };

  // 删除单个组
  const deleteGroup = (id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
    if (editingGroupId === id) {
      setEditingGroupId(null);
    }
  };

  // 切换编辑组状态
  const handleEditGroup = (id: string) => {
    if (editingGroupId === id) {
      setEditingGroupId(null); // 关闭编辑
    } else {
      setEditingGroupId(id); // 打开编辑
    }
  };

  // 更新组的配置
  const updateGroupConfig = (id: string, field: 'interval' | 'length', value: number) => {
    setGroups(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(g => g.id === id);
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], [field]: value };
      }
      return updated;
    });
  };



  const totalCrossLinesCount = perpendicularData?.features.length || 0;
  const totalSelectedSegments = groups.filter(g => g.end !== null).length;

  // 属性配置弹窗组件
  const PropertiesModal = ({ 
    config, 
    onSave, 
    onClose,
    title 
  }: { 
    config: typeof ANALYSIS_CONFIG_DEFAULT; 
    onSave: (newConfig: typeof ANALYSIS_CONFIG_DEFAULT) => void;
    onClose: () => void;
    title: string;
  }) => {
    const [year, setYear] = useState(config.year);
    const years = Array.from({ length: 17 }, (_, i) => (2010 + i).toString());

    const handleSave = () => {
      onSave({ ...config, year });
      onClose();
    };

    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          maxWidth: '600px',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ marginTop: 0 }}>{title}</h3>
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              年份 (year) - 可编辑:
            </label>
            <select 
              value={year} 
              onChange={(e) => setYear(e.target.value)}
              style={{ width: '100%', padding: '5px' }}
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '15px', opacity: 0.6 }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>其他属性（仅展示）:</label>
            <pre style={{ 
              backgroundColor: '#f5f5f5', 
              padding: '10px', 
              borderRadius: '4px',
              fontSize: '12px',
              maxHeight: '300px',
              overflow: 'auto'
            }}>
              {JSON.stringify({
                'bench-id': config['bench-id'],
                'ref-id': config['ref-id'],
                'dem-id': config['dem-id'],
                'current-timepoint': config['current-timepoint'],
                'comparison-timepoint': config['comparison-timepoint'],
                segment: config.segment,
                set: config.set,
                'water-qs': config['water-qs'],
                'tidal-level': config['tidal-level'],
                hs: config.hs,
                hc: config.hc,
                'protection-level': config['protection-level'],
                'control-level': config['control-level'],
                'risk-thresholds': config['risk-thresholds'],
                wNM: config.wNM,
                wRE: config.wRE,
                wGE: config.wGE,
                wRL: config.wRL
              }, null, 2)}
            </pre>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button 
              onClick={onClose}
              style={{ padding: '8px 16px', cursor: 'pointer' }}
            >
              取消
            </button>
            <button 
              onClick={handleSave}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: '#3b82f6', 
                color: 'white', 
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-full" />
      <div className="upload-control">
        <label className="upload-button">
          上传 GeoJSON
          <input
            type="file"
            accept=".geojson,application/json"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </label>
        {uploadedData && (
          <div className="upload-info">
            已加载 {uploadedData.features.length} 个要素
            <br />
            已选线段: {totalSelectedSegments} | 垂线总数: {totalCrossLinesCount}
          </div>
        )}
        
        <div className="config-section">
          <h4>1?? 全局垂线配置</h4>
          <div className="config-item">
            <label>垂线间距 (m):</label>
            <input
              type="number"
              value={globalInterval}
              onChange={(e) => setGlobalInterval(Number(e.target.value))}
              min="10"
              step="10"
            />
          </div>
          <div className="config-item">
            <label>垂线总长 (m):</label>
            <input
              type="number"
              value={globalLength}
              onChange={(e) => setGlobalLength(Number(e.target.value))}
              min="100"
              step="100"
            />
          </div>
          <div style={{marginTop: '10px', marginBottom: '10px'}}>
            <button 
              className={`toggle-button ${isSelectingShoreLines ? 'active' : ''}`}
              onClick={toggleShoreLineSelection}
              style={{marginRight: '5px'}}
            >
              {isSelectingShoreLines ? '? 正在选择岸段' : '?? 选择岸段'}
            </button>
            <button 
              className="generate-button"
              onClick={selectAllShoreLines}
              style={{marginRight: '5px'}}
            >
              ?? 全选岸段
            </button>
          </div>
          <p style={{fontSize: '13px', color: '#64748b', margin: '5px 0'}}>
            已选择 {selectedLines.size} 个岸段
            {isSelectingShoreLines && ' (点击地图上的线选择/取消选择)'}
          </p>
          <button className="generate-button" onClick={handleGenerateSections}>?? 绘制断面</button>
          {perpendicularData && perpendicularData.features.length > 0 && (
            <button 
              className="generate-button" 
              onClick={() => setShowGlobalPropertiesModal(true)}
              style={{ marginTop: '10px', backgroundColor: '#8b5cf6' }}
            >
              ?? 属性配置
            </button>
          )}
        </div>

        <div className="config-section">
          <h4>2?? 选择起止点（在地图上点击）</h4>
          <button 
            className={`toggle-button ${isSelectingStartEnd ? 'active' : ''}`}
            onClick={toggleStartEndSelection}
            style={{marginBottom: '10px'}}
          >
            {isSelectingStartEnd ? '? 起止点选择已开启' : '?? 开启起止点选择'}
          </button>
          <p style={{fontSize: '13px', color: '#64748b', margin: '5px 0'}}>
            {isSelectingStartEnd ? '提示：在地图线上点击两次选择起止点' : '点击上方按钮开启起止点选择模式'}
          </p>
        </div>

        {groups.length > 0 && (
          <div className="groups-list">
            <h4>选择组 ({groups.length})</h4>
            {groups.map((g, idx) => (
              <div key={g.id} className={`group-item ${editingGroupId === g.id ? 'editing' : ''}`}>
                <div className="group-header">
                  <span>组 {idx + 1}: {g.end === null ? '待选终点' : `已选 (${g.start.toFixed(0)}m - ${g.end.toFixed(0)}m)`}</span>
                  <div className="group-actions">
                    {g.end !== null && (
                      <button 
                        className={`edit-button ${editingGroupId === g.id ? 'active' : ''}`}
                        onClick={() => handleEditGroup(g.id)}
                      >
                        {editingGroupId === g.id ? '? 编辑中' : '?? 编辑'}
                      </button>
                    )}
                    <button onClick={() => deleteGroup(g.id)}>删除</button>
                  </div>
                </div>
                {editingGroupId === g.id && g.end !== null && (
                  <div className="group-config">
                    <div className="config-item">
                      <label>间距 (m):</label>
                      <input
                        type="number"
                        value={g.interval}
                        onChange={(e) => updateGroupConfig(g.id, 'interval', Number(e.target.value))}
                        min="10"
                        step="10"
                      />
                    </div>
                    <div className="config-item">
                      <label>长度 (m):</label>
                      <input
                        type="number"
                        value={g.length}
                        onChange={(e) => updateGroupConfig(g.id, 'length', Number(e.target.value))}
                        min="100"
                        step="100"
                      />
                    </div>
                    <button 
                      className="generate-button" 
                      onClick={() => setEditingPropertiesGroupId(g.id)}
                      style={{ marginBottom: '10px', backgroundColor: '#8b5cf6' }}
                    >
                      ?? 属性配置
                    </button>
                    <button className="apply-button" onClick={handleApplyCustomSegments}>? 应用配置</button>
                  </div>
                )}
                {g.crossData.length > 0 && (
                  <div className="group-info">
                    垂线: {g.crossData.length} 条 | 间距: {g.interval}m | 长度: {g.length}m
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="config-section">
          <h4>3?? 断面操作</h4>
          <button 
            className={`toggle-button ${isSelectingCrossLines ? 'active' : ''}`}
            onClick={toggleCrossLineSelection}
            style={{marginBottom: '10px'}}
          >
            {isSelectingCrossLines ? '? 断面拖拽模式已开启' : '?? 开启断面拖拽'}
          </button>
          {selectedCrossLineIndex !== null && (
            <div style={{marginBottom: '10px', padding: '10px', backgroundColor: '#f0f9ff', borderRadius: '4px'}}>
              <p style={{margin: '0 0 10px 0', fontWeight: 'bold', color: '#0369a1'}}>
                已选中断面 #{selectedCrossLineIndex + 1}
                {isDraggingCrossLine && <span style={{color: '#16a34a'}}> （拖拽中...）</span>}
              </p>
              <div style={{display: 'flex', gap: '5px', marginTop: '10px'}}>
                <button 
                  onClick={configureSelectedCrossLineProperties}
                  style={{flex: 1, padding: '8px', backgroundColor: '#8b5cf6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                >
                  ?? 属性配置
                </button>
                <button 
                  onClick={deleteSelectedCrossLine}
                  style={{flex: 1, padding: '8px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                >
                  ??? 删除
                </button>
              </div>
            </div>
          )}
          <p style={{fontSize: '13px', color: '#64748b', margin: '5px 0'}}>
            {isSelectingCrossLines ? '?? 按住鼠标左键拖拽断面到任意位置' : '点击上方按钮开启断面拖拽模式'}
          </p>
        </div>
        
        <div className="config-section">
          <h4>4?? 开始分析</h4>
          <button 
            className="analysis-button" 
            onClick={handleStartAnalysis}
            disabled={!perpendicularData || perpendicularData.features.length === 0}
          >
            ?? 开始分析（发送全部垂线）
          </button>
          <p style={{fontSize: '13px', color: '#64748b', margin: '5px 0'}}>
            {perpendicularData ? `当前共 ${perpendicularData.features.length} 条垂线` : '请先绘制断面'}
          </p>
        </div>

        <div className="config-section">
          <h4>?? 工具</h4>
          <button 
            className={`toggle-button ${!showCrossLines ? 'off' : ''}`}
            onClick={() => setShowCrossLines(!showCrossLines)}
          >
            {showCrossLines ? '??? 隐藏垂线' : '??? 显示垂线'}
          </button>
          <button className="clear-button" onClick={onClear}>?? 清空选择</button>
        </div>
      </div>

      {/* 全局属性配置弹窗 */}
      {showGlobalPropertiesModal && (
        <PropertiesModal
          config={globalProperties}
          title="全局属性配置"
          onSave={(newConfig) => {
            setGlobalProperties(newConfig);
            // 更新所有未自定义属性的垂线
            if (perpendicularData) {
              const updatedLines = perpendicularData.features.map(line => {
                const lineProp: any = line.properties || {};
                // 检查是否属于某个自定义属性组
                const belongsToCustomGroup = groups.some(g => {
                  if (!g.properties || g.end === null) return false;
                  try {
                    const mid = [(lineProp.leftPoint[0] + lineProp.rightPoint[0]) / 2, 
                                 (lineProp.leftPoint[1] + lineProp.rightPoint[1]) / 2];
                    const snapped = turf.nearestPointOnLine(g.line, turf.point(mid), { units: 'meters' });
                    const actualDist = snapped.properties.location ?? 0;
                    const start = Math.min(g.start, g.end);
                    const end = Math.max(g.start, g.end);
                    return actualDist >= start && actualDist <= end;
                  } catch {
                    return false;
                  }
                });
                
                if (!belongsToCustomGroup) {
                  line.properties = {
                    ...lineProp,
                    analysisConfig: newConfig
                  };
                }
                return line;
              });
              setPerpendicularData(turf.featureCollection(updatedLines as GeoJSON.Feature<GeoJSON.LineString>[]));
            }
            alert('全局属性配置已更新');
          }}
          onClose={() => setShowGlobalPropertiesModal(false)}
        />
      )}

      {/* 组属性配置弹窗 */}
      {editingPropertiesGroupId && (() => {
        // 检查是否是单个断面的属性配置
        if (editingPropertiesGroupId.startsWith('cross-line-')) {
          const index = parseInt(editingPropertiesGroupId.replace('cross-line-', ''));
          if (!perpendicularData || !perpendicularData.features[index]) return null;
          
          const currentLine = perpendicularData.features[index];
          const currentConfig = currentLine.properties?.analysisConfig || globalProperties;
          
          return (
            <PropertiesModal
              config={currentConfig}
              title={`断面 #${index + 1} 属性配置`}
              onSave={(newConfig) => {
                const updatedFeatures = [...perpendicularData.features];
                updatedFeatures[index] = {
                  ...currentLine,
                  properties: {
                    ...currentLine.properties,
                    analysisConfig: newConfig
                  }
                };
                setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
                alert(`断面 #${index + 1} 的属性配置已保存`);
                setEditingPropertiesGroupId(null);
              }}
              onClose={() => setEditingPropertiesGroupId(null)}
            />
          );
        }
        
        // 组属性配置
        const group = groups.find(g => g.id === editingPropertiesGroupId);
        if (!group) return null;
        return (
          <PropertiesModal
            config={{...globalProperties, ...(group.properties || {})}}
            title={`组 ${groups.findIndex(g => g.id === editingPropertiesGroupId) + 1} 属性配置`}
            onSave={(newConfig) => {
              setGroups(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(g => g.id === editingPropertiesGroupId);
                if (idx !== -1) {
                  updated[idx] = { ...updated[idx], properties: newConfig };
                }
                return updated;
              });
              alert(`组 ${groups.findIndex(g => g.id === editingPropertiesGroupId) + 1} 的属性配置已保存\n\n注意：需要点击"应用配置"才能将属性更新到垂线上`);
            }}
            onClose={() => setEditingPropertiesGroupId(null)}
          />
        );
      })()}
    </div>
  );
}

export default EditorPage;
