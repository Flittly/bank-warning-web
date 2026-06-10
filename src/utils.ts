import { ANALYSIS_CONFIG_DEFAULT } from './constants';

export { generatePerpendicularLines } from './utils/geometry';

/**
 * 发送断面数据到后端（移到 utils）
 */
export async function sendCrossLinesToBackend(
  crossData: { distance: number; left: number[]; right: number[]; analysisConfig?: typeof ANALYSIS_CONFIG_DEFAULT }[],
  groupId: string
) {
  console.log(`开始向后端发送组 ${groupId} 的 ${crossData.length} 条断面数据...`);

  try {
    const promises = crossData.map(async (item, index) => {
      const payload = {
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

      console.log(`正在发送断面 ${index + 1}/${crossData.length} (距离: ${item.distance.toFixed(2)}m):`, payload);

      const response = await fetch('/v0/mi/risk-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`断面 ${index + 1}/${crossData.length} (距离: ${item.distance.toFixed(2)}m) 已发送`);
      return result;
    });

    const results = await Promise.all(promises);
    console.log(`组 ${groupId} 的所有断面数据已成功发送到后端`);
    return results;
  } catch (error) {
    console.error(`发送组 ${groupId} 的断面数据时出错:`, error);
    throw error;
  }
}

export default { sendCrossLinesToBackend };
