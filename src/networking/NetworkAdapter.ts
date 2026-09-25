import type { GameAction, PlayerInput } from './protocol';

export interface PlayerSnapshot {
  id: number;
  name: string;
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  health: number;
  shield: number;
  alive: boolean;
  air: string;
}

export interface MatchSnapshot {
  time: number;
  phase: string;
  players: PlayerSnapshot[];
  storm: { x: number; z: number; r: number; nextX: number; nextZ: number; nextR: number } | null;
}

export type StateUpdateCallback = (snapshot: MatchSnapshot) => void;

/**
 * Transport-agnostic connection between a player (human or bot) and the
 * authoritative simulation. Offline play uses LocalGameAdapter/BotGameAdapter;
 * a future online mode would use WebSocketGameAdapter against /server.
 */
export interface NetworkAdapter {
  readonly kind: 'local' | 'bot' | 'websocket';
  readonly playerId: number;
  connect(): Promise<void>;
  disconnect(): void;
  sendInput(input: PlayerInput): void;
  sendAction(action: GameAction): void;
  onStateUpdate(callback: StateUpdateCallback): () => void;
}
