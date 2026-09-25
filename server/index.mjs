// Robnite — optional authoritative server SKELETON.
//
// The shipped game is fully offline (LocalGameAdapter + BotGameAdapter). This
// file shows the protocol a future online mode would use with
// src/networking/WebSocketGameAdapter.ts. It accepts players, receives their
// inputs/actions and broadcasts snapshots at 20 Hz. It does NOT yet run the
// game simulation: the next step is to import src/game/Match.ts (e.g. via a
// TypeScript build of the simulation layer, which has no DOM dependencies)
// and feed inputs into Match.setInput / Match.queueAction.
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port: PORT });
const players = new Map(); // socket -> { id, name, lastInput }
let nextId = 1;
let time = 0;

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'malformed message' }));
      return;
    }
    if (msg.type === 'join') {
      const id = nextId++;
      players.set(ws, { id, name: String(msg.name ?? 'Player').slice(0, 16), lastInput: null });
      ws.send(JSON.stringify({ type: 'welcome', playerId: id }));
    } else if (msg.type === 'input') {
      const p = players.get(ws);
      if (p) p.lastInput = msg.input; // TODO: match.setInput(p.id, msg.input)
    } else if (msg.type === 'action') {
      // TODO: validate and match.queueAction(p.id, msg.action)
    }
  });
  ws.on('close', () => players.delete(ws));
});

setInterval(() => {
  time += 0.05;
  const snapshot = {
    time,
    phase: 'WARMUP',
    storm: null,
    players: [...players.values()].map((p) => ({ id: p.id, name: p.name, pos: [0, 0, 0], yaw: p.lastInput?.yaw ?? 0, pitch: p.lastInput?.pitch ?? 0, health: 100, shield: 0, alive: true, air: 'none' })),
  };
  const data = JSON.stringify({ type: 'snapshot', snapshot });
  for (const ws of players.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
}, 50);

console.log(`[Robnite][Server] skeleton listening on ws://localhost:${PORT}`);
