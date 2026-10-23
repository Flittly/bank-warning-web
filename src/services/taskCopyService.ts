import { authHeaders } from '../utils/apiClient';

/**
 * 「复制任务」接口封装。
 *
 * <p>为什么单独一个文件：复制不是「新建任务」的变体，两者的关键差别是
 * **不重新生成断面、不重跑模型、默认不搬结果** —— 混进新建任务的链路里最难发现的问题
 * 就是「复制时顺手把源任务的断面清了」。
 *
 * <p>前端只负责「起名字 + 选要不要结果」，一切重映射（task_id / section_id / param_id）
 * 都在服务端一个事务里完成，前端不参与 id 生成 —— 复制失败重试时才不会写出一半。
 */

export interface TaskCopyOptions {
  /** 新任务名；缺省由服务端拼「原名 - 副本」 */
  task_name?: string;
  /** 是否连计算结果与剖面一起复制（默认 false） */
  include_results?: boolean;
  /** 是否复制任务私有参数集（默认 true） */
  include_params?: boolean;
  /** 是否把断面校验结论打回 pending（默认 false） */
  reset_validation?: boolean;
  /** 幂等重试用的目标 id，正常调用不传 */
  target_task_id?: string;
}

export interface TaskCopyWarning {
  code: string;
  message: string;
}

export interface TaskCopyResult {
  success: boolean;
  task_id: string;
  task_name: string;
  source_task_id: string;
  counts: { params: number; sections: number; results: number; profiles: number };
  warnings: TaskCopyWarning[];
  idempotent: boolean;
  elapsed_ms: number;
}

export async function copyTask(taskId: string, options: TaskCopyOptions = {}): Promise<TaskCopyResult> {
  const res = await fetch(`/v0/bank/tasks/${encodeURIComponent(taskId)}/copy`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // 后端 500 时可能回 HTML/空体；此时把原文带出来比 "Unexpected token" 有用
    throw new Error(`复制任务失败：HTTP ${res.status} ${text.slice(0, 200) || res.statusText}`);
  }

  if (!res.ok) {
    const code = data?.error?.code || `HTTP_${res.status}`;
    const detail = data?.error?.message || res.statusText;
    throw new Error(`${code}：${detail}`);
  }
  return data as TaskCopyResult;
}

/**
 * 把复制结果拼成一条回执文案。
 *
 * <p>warnings 必须露出来：源任务在跑（副本不含在途结果）、参数是现物化的、
 * 某些岸段已失效 —— 这些都不阻断复制，但用户不看就不知道副本为什么不完整。
 */
export function describeCopyResult(result: TaskCopyResult): string {
  const parts: string[] = [`${result.counts.sections} 条断面`];
  if (result.counts.params > 0) parts.push('1 份参数');
  if (result.counts.results > 0) parts.push(`${result.counts.results} 条结果`);
  if (result.counts.profiles > 0) parts.push(`${result.counts.profiles} 条剖面`);

  const head = `已创建副本「${result.task_name}」，复制了 ${parts.join(' / ')}`;
  const tail = result.warnings.length
    ? `；注意：${result.warnings.map((w) => w.message).join('；')}`
    : '';
  return head + tail;
}
