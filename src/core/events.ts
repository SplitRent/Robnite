/**
 * Lightweight typed event bus. Simulation systems emit events; rendering,
 * audio, UI and progression listen. This keeps systems decoupled.
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<EventMap extends object> {
  private listeners = new Map<keyof EventMap, Set<Listener<never>>>();

  on<K extends keyof EventMap>(type: K, fn: Listener<EventMap[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  off<K extends keyof EventMap>(type: K, fn: Listener<EventMap[K]>): void {
    this.listeners.get(type)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as Listener<EventMap[K]>)(payload);
      } catch (err) {
        console.error(`[Robnite][Events] listener for "${String(type)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
