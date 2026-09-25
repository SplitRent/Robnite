import type { Match } from '../game/Match';
import type { NetworkAdapter, StateUpdateCallback } from './NetworkAdapter';
import type { GameAction, PlayerInput } from './protocol';

/**
 * A bot's "connection" to the simulation. Bot brains send exactly the same
 * inputs and actions as a human client — no privileged API.
 */
export class BotGameAdapter implements NetworkAdapter {
  readonly kind = 'bot' as const;
  private connected = true;

  constructor(private match: Match, readonly playerId: number) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  sendInput(input: PlayerInput): void {
    if (this.connected) this.match.setInput(this.playerId, input);
  }

  sendAction(action: GameAction): void {
    if (this.connected) this.match.queueAction(this.playerId, action);
  }

  onStateUpdate(_callback: StateUpdateCallback): () => void {
    // Bots perceive the simulation directly through their sensors.
    return () => undefined;
  }
}
