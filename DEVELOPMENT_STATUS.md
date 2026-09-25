# Development status

## Done
- Core simulation: grid building/editing/destruction/support, collision, movement, combat, loot, storm, bots, all five modes + tutorial (`src/game`, `src/building`, `src/physics`, `src/ai`, …).
- Rendering, HUD, lobby (play, locker, battle pass, shop, quests, career, settings), pause/results flows, procedural audio.
- Progression (XP, levels, battle pass, quests, credits, shop, daily login, codes) with a versioned save.
- Tests: `npm test` (56 unit/simulation tests), `npm run test:e2e` (browser smoke test).
- GitHub Pages workflow (`.github/workflows/deploy.yml`).

## Next steps
1. Online play: run `Match` inside `server/index.mjs` and add an online mode using `WebSocketGameAdapter` (client-side interpolation of `MatchSnapshot`).
2. Bot navigation: add a coarse navigation grid for interiors (`src/ai/BotBrain.ts`, `steer()`).
3. Content: more weapons/consumables (`src/weapons/weapons.ts`, `src/inventory/items.ts`) and seasonal map changes via `SeasonConfig.mapChanges`.
