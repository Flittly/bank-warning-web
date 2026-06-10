let currentTaskId: string | null = null;

export function getCurrentTaskId(): string | null {
  return currentTaskId;
}

export function setCurrentTaskId(nextTaskId: string | null) {
  currentTaskId = nextTaskId;
}
