import { logger } from '../core/log';
import { SafeStorage } from './storage';
import { SAVE_KEY, SAVE_VERSION, defaultSave, mergeDefaults, migrate, type SaveData } from './schema';
import { COSMETIC_BY_ID, DEFAULT_EQUIPPED, DEFAULT_OWNED } from '../cosmetics/catalog';

const log = logger('Save');

/** Loads, validates, migrates and persists the local save. */
export class SaveManager {
  data: SaveData;
  private listeners = new Set<(d: SaveData) => void>();
  private pending: ReturnType<typeof setTimeout> | null = null;
  lastError: string | null = null;

  constructor(readonly storage = new SafeStorage()) {
    this.data = this.load();
  }

  get persistent(): boolean {
    return this.storage.persistent;
  }

  load(): SaveData {
    const raw = this.storage.get(SAVE_KEY);
    if (!raw) return defaultSave();
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed !== 'object' || parsed === null) throw new Error('save root is not an object');
      if (typeof parsed.version === 'number' && parsed.version > SAVE_VERSION) {
        log.warn(`save version ${parsed.version} is newer than supported ${SAVE_VERSION}; loading compatible fields`);
      }
      const migrated = migrate(parsed);
      const data = mergeDefaults(defaultSave(), migrated);
      data.version = SAVE_VERSION;
      this.sanitize(data);
      return data;
    } catch (e) {
      log.error('save data was unreadable — starting fresh (a backup was kept)', e);
      this.storage.set(`${SAVE_KEY}.corrupt.${Date.now()}`, raw);
      this.lastError = 'Your previous save could not be read. A backup was kept and a new profile was created.';
      return defaultSave();
    }
  }

  /** Repair invariants (owned defaults, valid equipped ids, numeric ranges). */
  private sanitize(d: SaveData): void {
    const inv = new Set(d.profile.inventory.filter((id) => typeof id === 'string' && COSMETIC_BY_ID.has(id)));
    for (const id of DEFAULT_OWNED) inv.add(id);
    d.profile.inventory = [...inv];
    for (const [slot, def] of Object.entries(DEFAULT_EQUIPPED) as [keyof typeof DEFAULT_EQUIPPED, string][]) {
      const id = d.profile.equipped[slot];
      const item = COSMETIC_BY_ID.get(id);
      if (!item || !inv.has(id) || item.category !== slot) d.profile.equipped[slot] = def;
    }
    d.profile.level = Math.max(1, Math.floor(d.profile.level) || 1);
    d.profile.currency = Math.max(0, Math.floor(d.profile.currency) || 0);
    d.battlePass.level = Math.min(50, Math.max(1, Math.floor(d.battlePass.level) || 1));
    if (d.matchHistory.length > 30) d.matchHistory = d.matchHistory.slice(0, 30);
  }

  /** Persist now. */
  save(): boolean {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    const ok = this.storage.set(SAVE_KEY, JSON.stringify(this.data));
    for (const l of this.listeners) l(this.data);
    return ok;
  }

  /** Debounced save for frequent small changes (sliders). */
  saveSoon(): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => this.save(), 250);
    for (const l of this.listeners) l(this.data);
  }

  onChange(fn: (d: SaveData) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset(): void {
    this.storage.remove(SAVE_KEY);
    this.data = defaultSave();
    this.save();
  }
}
