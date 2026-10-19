import { authHeaders } from '../utils/apiClient';
import { fetchTaskParamsAsSectionParams } from '../pages/editor/basicParamsApi';

let currentBasicParamId: number | null = null;

export const setCurrentBasicParamId = (id: number | null) => {
  currentBasicParamId = id;
};

/**
 * 每个任务自己的参数集 id 缓存。
 *
 * 断面必须挂任务参数（basic_params.task_id 非空），不能再挂模板库 ——
 * 挂模板库就是「引用」，改一次模板就会改掉所有引用它的任务。这里按任务缓存，
 * 断面批量创建时不用每条都请求一次。
 */
const taskParamsIdCache = new Map<string, number>();

export const invalidateTaskParamsCache = (taskId?: string) => {
  if (taskId) taskParamsIdCache.delete(taskId);
  else taskParamsIdCache.clear();
};

/**
 * 取（必要时物化）某任务的参数集数值 id，供断面 basic_param_id 使用。
 * 返回 null 表示后端没有可用来源（既没有断面快照，模板库也空）。
 */
export const ensureTaskParamsId = async (
  taskId: string,
  templateParamId?: string | null,
): Promise<number | null> => {
  const cached = taskParamsIdCache.get(taskId);
  if (cached != null) return cached;

  try {
    const { numericId } = await fetchTaskParamsAsSectionParams(taskId, templateParamId);
    if (numericId == null) return null;
    taskParamsIdCache.set(taskId, numericId);
    return numericId;
  } catch (err) {
    console.error('获取任务参数失败:', err);
    return null;
  }
};

export const ensureDefaultBasicParams = async (): Promise<number | null> => {
  if (currentBasicParamId !== null) {
    return currentBasicParamId;
  }

  try {
    const listResponse = await fetch('/v0/bank/basic-params', { headers: { ...authHeaders() } });
    if (listResponse.ok) {
      const listData = await listResponse.json();
      console.log('基础参数列表响应:', listData);
      if (listData.success && listData.params && listData.params.length > 0) {
        currentBasicParamId = listData.params[0].id;
        console.log('使用现有基础参数:', currentBasicParamId);
        return currentBasicParamId;
      }
    }

    console.log('创建默认基础参数模板...');
    const defaultParams = {
      params: [
        {
          id: 53,
          param_id: 'PARAM_DEFAULT_TEMPLATE',
          param_name: '默认参数模板',
          segment: 'Mzs',
          current_timepoint: '202304',
          set_name: 'standard',
          water_qs: '10000',
          tidal_level: 'zc',
          bench_id: 'tiff\\Mzs\\2023\\standard\\202304\\202404.tif',
          ref_id: 'tiff\\Mzs\\2019\\standard\\201904\\201904.tif',
          hs: 0.5,
          hc: 2,
          protection_level: 'systemic',
          control_level: 'strict',
          comparison_timepoint: '201904',
          risk_thresholds: {
            Ky: [1.7, 1.35, 1],
            Ln: [0.04, 0.12, 0.2],
            PQ: [0.5, 1, 2.3],
            Sa: [0.2, 0.3, 0.5],
            Zb: [20, 30, 40],
            Zd: [0.1, 0.15, 0.3],
            all: [0.25, 0.5, 0.75],
            Dsed: [0.7, 1, 1.5],
          },
          weights: {
            wGE: [0.6, 0.2, 0.2],
            wNM: [0.43, 0.32, 0.25],
            wRE: [0.48, 0.16, 0.36],
            wRL: [0.32, 0.43, 0.25],
          },
          other_params: {
            pq_data: {
              '2010': 2.59,
              '2011': 0.15,
              '2012': 2.42,
              '2013': 0,
              '2014': 0.67,
              '2015': 1.29,
              '2016': 3.2,
              '2017': 1.1,
              '2018': 0.29,
              '2019': 1.68,
              '2020': 3.68,
              '2021': 1.35,
              '2022': 1.1,
              '2023': 0,
            },
            is_default: true,
          },
        },
      ],
      overwrite: false,
    };

    const createResponse = await fetch('/v0/bank/basic-params', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(defaultParams),
    });

    if (!createResponse.ok) {
      console.error('创建默认基础参数失败:', createResponse.statusText);
      return null;
    }

    const createData = await createResponse.json();
    if (createData.success && createData.params && createData.params.length > 0) {
      currentBasicParamId = createData.params[0].id;
      console.log('默认基础参数创建成功，ID:', currentBasicParamId);
      return currentBasicParamId;
    }

    return null;
  } catch (err) {
    console.error('确保默认基础参数出错:', err);
    return null;
  }
};
