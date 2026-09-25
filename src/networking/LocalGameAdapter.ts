import type { Match } from '../game/Match';
import type { MatchSnapshot, NetworkAdapter, StateUpdateCallback } from './NetworkAdapter';
import type { GameAction, PlayerInput } from './protocol';

export function snapshotOf(match: Match): MatchSnapshot {
  const s = match.storm;
  return {
    time: match.time,
    phase: match.phase,
    players: match.combatants.map((c) => ({
      id: c.id,
      name: c.name,
      pos: [c.pos.x, c.pos.y, c.pos.z],
      yaw: c.yaw,
      pitch: c.pitch,
      health: c.health,
      shield: c.shield,
      alive: c.alive,
      air: c.air,
    })),
    storm: s ? { x: s.centerX, z: s.centerZ, r: s.radius, nextX: s.nextX, nextZ: s.nextZ, nextR: s.nextRadius } : null,
  };
}

/**
 * In-process adapter for the local human player. It also owns stepping the
 * simulation (there is no server offline) and publishes snapshots.
 */
export class LocalGameAdapter implements NetworkAdapter {
  readonly kind = 'local' as const;
  private listeners = new Set<StateUpdateCallback>();
  private connected = false;
  private snapshotTimer = 0;

  constructor(private match: Match, readonly playerId: number) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
    this.listeners.clear();
  }

  sendInput(input: PlayerInput): void {
    if (this.connected) this.match.setInput(this.playerId, input);
  }

  sendAction(action: GameAction): void {
    if (this.connected) this.match.queueAction(this.playerId, action);
  }

  onStateUpdate(callback: StateUpdateCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Advance the authoritative simulation by one fixed step. */
  step(dt: number): void {
    if (!this.connected) return;
    this.match.step(dt);
    this.snapshotTimer += dt;
    if (this.listeners.size && this.snapshotTimer >= 0.1) {
      this.snapshotTimer = 0;
      const snap = snapshotOf(this.match);
      for (const l of this.listeners) l(snap);
    }
  }
}
