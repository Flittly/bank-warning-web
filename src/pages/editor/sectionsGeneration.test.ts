import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useResourceTreeStore } from '../../store/useResourceTreeStore';
import { runCurrentTask } from './sectionsGeneration';

vi.mock('antd', () => ({
  message: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/apiClient', () => ({
  authHeaders: () => ({}),
}));

describe('runCurrentTask', () => {
  beforeEach(() => {
    useResourceTreeStore.setState({ currentTaskId: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('运行 store 中当前选中的任务', async () => {
    useResourceTreeStore.getState().setCurrentTask('task-selected');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, status: 'completed', results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await runCurrentTask({
      perpendicularData: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            properties: {},
          },
        ],
      } as GeoJSON.FeatureCollection,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/v0/bank/tasks/task-selected/run',
      expect.anything(),
    );
  });
});
