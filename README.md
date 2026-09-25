# ROBNITE

**Browser build shooter / battle royale.** Drop into Hollow Ridge, loot, harvest, build and edit your way through 15 bots — or practise 1v1 duels, box fights, zone wars and freebuild. Everything runs in the browser: no server, no account, no installs.

> Robnite is an original game. It is inspired by the general build-shooter genre, but all names, art, UI, map, items, cosmetics and sounds are original (geometry, textures and audio are generated procedurally at runtime).

## Features

- **Five modes** — Battle Royale (16 players: you + 15 bots, deployment from a drop ship, glider, loot, chests, shrinking storm), Duel (1v1, first elimination wins, rematch), Box Fight (first to 3 rounds, pre-built boxes), Zone War (8 players, fast storm, first to 2 rounds) and Freebuild (unlimited materials/ammo, targets, strafing dummies, edit walls, practice stations). Plus a guided **tutorial**.
- **Deterministic grid building** — wall, floor, ramp and cone on a global 4 m × 3.2 m grid. The build target comes from the centre-screen camera ray → hit point + normal → snapped grid slot. The ghost preview *is* the placed piece: the client sends exactly the previewed target and the simulation places it there or not at all. Materials (wood/stone/metal) with build-up health, validation (occupancy, range, materials, players, world, terrain, support), structural collapse, rotation, hold-to-build.
- **Editing** — 3×3 wall edits (window, door, arches…), 2×2 floor/cone edits, ramp direction edits. Drag-select, edit-on-release, hold-to-edit, reset. Collision switches instantly to the edited shape — you can walk and shoot through openings.
- **Combat** — Vanguard Rifle, Hornet SMG, Breaker Pump (pellets, shell-by-shell reload), Longwatch DMR (scope), pickaxe. Hitscan with head/body/leg regions, falloff, bloom, recoil, ADS, reloads, finite/unlimited ammo, shields, healing items, fall damage, storm damage, five rarity tiers.
- **Bots** — perceive the world through a view cone, line of sight and hearing (no wall hacks), with reaction time, aim error, recoil and four difficulties. They loot with utility scores, harvest, heal, rotate with the storm, fight, build walls/ramps/boxes and edit — using the same input/action API as the player.
- **Progression** — account levels, a 50-tier Battle Pass (free + cosmetic premium track unlocked with in-game Credits), daily & weekly quests tracked live, career stats and match history, daily login bonus, redeem codes.
- **Cosmetics** — outfits, back accessories, pickaxes, gliders, emotes, weapon wraps, banners and loading screens; a deterministic daily item shop using fictional Credits (no real money); a locker to equip everything on the 3D lobby character.
- **Settings** — video presets with conservative auto-detection, render scale, shadows, effects, particles, view distance, tone mapping, baked AO, FOV, FPS limit; per-bus audio volumes; mouse sensitivities (ADS/scope/build); every action rebindable with conflict detection; gameplay, HUD and crosshair customisation; accessibility (colour-blind palettes, reduced motion, screen shake, subtitles, UI scale, high contrast, reduced flashing).
- **Save system** — versioned local save with migrations, field-by-field defaults (one bad field never wipes the save), corrupt-save backup and a double-confirmed reset.

## Tech stack

TypeScript (strict) · Vite · Three.js (WebGL) · Web Audio API · localStorage · Vitest · Playwright (end-to-end smoke test). Physics/collision is a small purpose-built kinematic system (spatial-hashed AABBs, one-sided ramp/roof surfaces and a heightfield) rather than a general physics engine.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173 (dev tools enabled)
```

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm test           # unit + simulation tests (Vitest)
npm run test:e2e   # browser smoke test against the production build (needs Chromium; set CHROMIUM_PATH if Playwright's bundled browser is not installed)
```

Developer tools are available in `npm run dev`, or in any build with `?dev=1` in the URL:

| Key | Tool |
| --- | --- |
| F1 | Debug overlay: FPS, draw calls, triangles, memory, coordinates, grid cell, storm, bot states, collision boxes, and the **BUILD DEBUG** panel with crosshair ray, hit point, normal, target cell and preview bounds |
| F2 | Give materials |
| F3 | Give all weapons |
| F4 | Pause/resume storm |
| F5 | Spawn (revive) a bot in front of you |
| F6 | Kill all bots |
| F7 | Reset builds |

Settings → General also shows **+10,000 Credits** and **+10,000 XP** buttons in dev mode.

## GitHub Pages deployment

The Vite config uses a relative `base` (`./`), so the build works from any sub-path. `.github/workflows/deploy.yml` installs dependencies, runs the tests, builds and publishes `dist/` to GitHub Pages on every push to `main`.

To enable it: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site will be served at `https://<user>.github.io/<repo>/`.

## Controls (defaults — all rebindable)

| Action | Key | Action | Key |
| --- | --- | --- | --- |
| Move | W A S D | Wall / Floor / Ramp / Roof | Z / X / C / V |
| Jump | Space | Toggle build mode | Q |
| Sprint | Shift | Rotate piece | R (in build mode) |
| Crouch / slide | Ctrl | Edit | E |
| Fire / place | Left click | Reset edit | R or right click (in edit mode) |
| Aim | Right click | Change material | T |
| Reload | R | Interact / pick up / open | E |
| Pickaxe | F | Inventory | Tab |
| Weapon slots | 1–5, mouse wheel | Map & scoreboard | M |
| Emote | B | Menu / pause | Esc |
| Practice: reset builds / respawn | H / J | | |

Shared keys are resolved by context: **R** reloads, rotates while building and resets while editing; **E** interacts when loot/chests/doors are under the crosshair and edits otherwise. Space jumps from the drop ship and opens/closes the glider.

## Architecture

```
src/
  core/        constants, typed event bus, seeded RNG/noise, math, logging
  physics/     heightfield terrain, spatial-hash collision world, raycasts, kinematic character controller
  building/    grid math, crosshair→grid targeting, BuildSystem (validate/place/edit/damage/support), edit presets
  weapons/     weapon data + rarity scaling, CombatSystem (hitscan, pellets, hit regions, reload, healing, pickaxe)
  inventory/   items, rarity, inventory slots & ammo
  loot/        data-driven loot pool and chest tables
  player/      Combatant state (shared by humans and bots), movement (ground, air, skydive, glide)
  ai/          BotBrain — perception, state machine, aim, looting, building, editing
  map/         map builder, Hollow Ridge, duel/box/zone/training arenas
  storm/       deterministic shrinking storm
  game/        Match (authoritative fixed-step simulation + match state machine), WorldState, modes,
               GameClient (input → simulation → rendering loop), BuildController, ClientEffects, Tutorial
  networking/  NetworkAdapter interface, LocalGameAdapter, BotGameAdapter, WebSocketGameAdapter, protocol
  rendering/   renderer, world/terrain, build pieces & ghost, characters, effects, sky, storm, loot, lobby scene
  camera/      third-person camera with collision, recoil, ADS/scope, sprint FOV
  input/       rebindable input with pointer lock, bindings & conflict detection
  audio/       procedural Web Audio engine (SFX, music, ambience, announcer)
  ui/          App (screens & flow), lobby pages, HUD, minimap, overlays, icons
  progression/ XP, levels, battle pass, quests, currency, daily login, codes
  cosmetics/   cosmetic catalogue, daily shop rotation, ShopService
  season/      SeasonConfig and Battle Pass rewards
  quests/      quest data and progress
  settings/    settings model, presets, hardware detection
  save/        storage wrapper, versioned schema, migrations, SaveManager
  debug/       developer overlay
server/        optional WebSocket server skeleton (not needed to play)
tests/         Vitest suites (building, editing, destruction, combat, bots, matches, save/progression) + e2e smoke test
```

The simulation (`Match` and everything below it) has no DOM or WebGL dependency — it runs headless in the unit tests. Each frame the client samples input, sends a `PlayerInput` and discrete `GameAction`s through its `NetworkAdapter`, steps the simulation at a fixed 60 Hz (rendering interpolates), then renders. Systems communicate through a typed event bus (`BUILD_PLACED`, `PLAYER_DAMAGE`, `PLAYER_ELIMINATED`, `MATCH_ENDED`, …); presentation code only listens.

## Known limitations

- **No online multiplayer.** All matches are offline against bots. The networking layer is designed for it (see below), but no online mode is exposed.
- The shop rotation is computed locally from the date; it is not synchronised between players. Credits are fictional and there are no real payments.
- Bots use steering + obstacle probes rather than full navmesh pathfinding, so they occasionally get stuck on complex interiors (they detour, jump, edit or break through builds to recover).
- Anti-aliasing changes apply after restarting the game; shadow, effect and particle quality apply from the next match. Motion blur is not implemented.
- Terrain is a heightfield, so "underground" areas (quarry galleries, chapel basement) are built above ground inside cuts and plinths rather than true tunnels.
- Mobile/touch input is not supported (desktop keyboard + mouse; 1280×720 and up).
- Fonts are bundled; the game works offline once built.

## Future multiplayer architecture

```
GameSimulation (src/game/Match.ts — authoritative, deterministic fixed step, no DOM)
      ↓
NetworkAdapter (src/networking/NetworkAdapter.ts)
      ├── LocalGameAdapter      — shipped: in-process, steps the simulation
      ├── BotGameAdapter        — shipped: each bot's "connection", same API as players
      └── WebSocketGameAdapter  — client for the server protocol
```

`server/index.mjs` is a skeleton WebSocket server that speaks the same protocol (join → welcome, input, action, snapshot). To go online, run `Match` on the server, feed it received inputs/actions, broadcast `snapshotOf(match)` and render snapshots on clients with interpolation. Pause would become a settings overlay (the simulation keeps running) and tab-outs would show a notice instead of pausing.
