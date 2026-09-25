import { logger } from '../core/log';

const log = logger('Save');

/** localStorage wrapper that degrades to memory when storage is blocked. */
export class SafeStorage {
  private memory = new Map<string, string>();
  readonly persistent: boolean;

  constructor(private backend: Storage | null = SafeStorage.detect()) {
    this.persistent = backend !== null;
    if (!this.persistent) log.warn('localStorage unavailable — progress will not persist this session');
  }

  static detect(): Storage | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const k = '__robnite_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return localStorage;
    } catch {
      return null;
    }
  }

  get(key: string): string | null {
    if (this.backend) {
      try {
        return this.backend.getItem(key);
      } catch (e) {
        log.warn('read failed', e);
      }
    }
    return this.memory.get(key) ?? null;
  }

  set(key: string, value: string): boolean {
    this.memory.set(key, value);
    if (!this.backend) return false;
    try {
      this.backend.setItem(key, value);
      return true;
    } catch (e) {
      log.error('write failed (quota or blocked storage)', e);
      return false;
    }
  }

  remove(key: string): void {
    this.memory.delete(key);
    try {
      this.backend?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
