export interface TiffResource {
  tiff_key: string;
  segment?: string;
  year?: string;
  timepoint?: string;
  file_name?: string;
  [key: string]: any;
}

const TIFF_ENDPOINT = '/v0/bank/tiffs';

let cachedTiffResources: TiffResource[] | null = null;
let cachedTiffPromise: Promise<TiffResource[]> | null = null;

export const normalizeTiffKey = (value: string): string => {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
};

const extractTiffKey = (raw: any): string => {
  const key =
    raw?.tiff_key ??
    raw?.tiffKey ??
    raw?.key ??
    raw?.tiff_id ??
    raw?.tiffId ??
    raw?.tiff_path ??
    raw?.tiffPath ??
    raw?.path ??
    raw?.storage_path ??
    raw?.storagePath ??
    raw?.file_name ??
    raw?.fileName ??
    raw?.name ??
    '';

  return normalizeTiffKey(String(key || ''));
};

const normalizeTiffResource = (raw: any): TiffResource | null => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const key = normalizeTiffKey(raw);
    return key ? { tiff_key: key } : null;
  }

  const tiffKey = extractTiffKey(raw);
  if (!tiffKey) return null;

  return {
    ...raw,
    tiff_key: tiffKey,
    segment: raw?.segment ?? raw?.segment_code ?? raw?.segmentCode,
    year: raw?.year != null ? String(raw.year) : raw?.tiff_year != null ? String(raw.tiff_year) : undefined,
    timepoint:
      raw?.timepoint != null
        ? String(raw.timepoint)
        : raw?.tiff_timepoint != null
          ? String(raw.tiff_timepoint)
          : undefined,
    file_name: raw?.file_name ?? raw?.fileName ?? raw?.name,
  };
};

const normalizeTiffResourceList = (payload: any): TiffResource[] => {
  const list = Array.isArray(payload)
    ? payload
    : payload?.tiffs ?? payload?.items ?? payload?.rows ?? payload?.data ?? payload?.records ?? payload;

  if (Array.isArray(list)) {
    return list.map(normalizeTiffResource).filter((item): item is TiffResource => Boolean(item));
  }

  const single = normalizeTiffResource(list);
  return single ? [single] : [];
};

export function invalidateTiffResourceCache() {
  cachedTiffResources = null;
  cachedTiffPromise = null;
}

export async function fetchTiffResources(forceRefresh = false): Promise<TiffResource[]> {
  if (!forceRefresh && cachedTiffResources) {
    return cachedTiffResources;
  }

  if (!forceRefresh && cachedTiffPromise) {
    return cachedTiffPromise;
  }

  cachedTiffPromise = (async () => {
    const res = await fetch(TIFF_ENDPOINT);
    if (!res.ok) {
      throw new Error(`获取 TIFF 列表失败: ${res.status} ${res.statusText}`);
    }

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }

    const resources = normalizeTiffResourceList(data);
    cachedTiffResources = resources;
    cachedTiffPromise = null;
    return resources;
  })();

  return cachedTiffPromise;
}

export async function uploadTiffResource(formData: FormData): Promise<TiffResource> {
  const res = await fetch(`${TIFF_ENDPOINT}/upload`, {
    method: 'POST',
    body: formData,
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }

  if (!res.ok) {
    const detail = typeof data === 'string' && data.trim() ? ` - ${data}` : '';
    throw new Error(`上传 TIFF 失败: ${res.status} ${res.statusText}${detail}`);
  }

  const candidate =
    data?.tiff ??
    data?.tiff_info ??
    data?.tiffInfo ??
    data?.item ??
    data?.data ??
    data?.record ??
    data;

  const resource = normalizeTiffResource(candidate);
  if (!resource) {
    throw new Error('上传成功但未返回有效的 TIFF 信息');
  }

  invalidateTiffResourceCache();
  return resource;
}

export async function deleteTiffResource(tiffKey: string): Promise<void> {
  const key = normalizeTiffKey(tiffKey);
  if (!key) {
    throw new Error('缺少 tiff_key');
  }

  const res = await fetch(`${TIFF_ENDPOINT}?tiff_key=${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const suffix = text ? ` - ${text}` : '';
    throw new Error(`删除 TIFF 失败: ${res.status} ${res.statusText}${suffix}`);
  }

  invalidateTiffResourceCache();
}

const formatOptional = (value: string | undefined) => (value ? value : '未知');

export function formatTiffResourceLabel(resource: TiffResource): string {
  const segment = formatOptional(resource.segment ?? resource.region_code);
  const year = formatOptional(resource.year);
  const timepoint = formatOptional(resource.timepoint);
  const suffix = resource.file_name ? ` · ${resource.file_name}` : '';
  return `${segment} · ${year}/${timepoint}${suffix} · ${resource.tiff_key}`;
}
