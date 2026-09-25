import type { MatchSnapshot, NetworkAdapter, StateUpdateCallback } from './NetworkAdapter';
import type { GameAction, PlayerInput } from './protocol';
import { logger } from '../core/log';

const log = logger('Net');

type ServerMessage = { type: 'welcome'; playerId: number } | { type: 'snapshot'; snapshot: MatchSnapshot } | { type: 'error'; message: string };

/**
 * Client for the optional authoritative server in /server. Not used by the
 * shipped offline build; provided so online play can be added without
 * changing gameplay code.
 */
export class WebSocketGameAdapter implements NetworkAdapter {
  readonly kind = 'websocket' as const;
  playerId = -1;
  private ws: WebSocket | null = null;
  private listeners = new Set<StateUpdateCallback>();
  private seq = 0;

  constructor(private url: string, private displayName: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('connection timed out'));
      }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', name: this.displayName }));
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('connection failed'));
      };
      ws.onclose = () => log.warn('server connection closed');
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          log.error('malformed server message');
          return;
        }
        if (msg.type === 'welcome') {
          this.playerId = msg.playerId;
          clearTimeout(timeout);
          resolve();
        } else if (msg.type === 'snapshot') {
          for (const l of this.listeners) l(msg.snapshot);
        } else if (msg.type === 'error') log.error(msg.message);
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
  }

  sendInput(input: PlayerInput): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'input', seq: this.seq++, input }));
  }

  sendAction(action: GameAction): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'action', action }));
  }

  onStateUpdate(callback: StateUpdateCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}
