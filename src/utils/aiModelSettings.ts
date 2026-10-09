export const AI_MODEL_STORAGE_KEY = 'ai-chat-model';
export const AI_MODEL_CHANGED_EVENT = 'ai-model-changed';

export function getStoredAiModel(): string {
  try {
    return localStorage.getItem(AI_MODEL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredAiModel(key: string): void {
  try {
    localStorage.setItem(AI_MODEL_STORAGE_KEY, key);
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(AI_MODEL_CHANGED_EVENT, { detail: key }));
}

export function onAiModelChanged(cb: (key: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(AI_MODEL_CHANGED_EVENT, handler);
  return () => window.removeEventListener(AI_MODEL_CHANGED_EVENT, handler);
}
