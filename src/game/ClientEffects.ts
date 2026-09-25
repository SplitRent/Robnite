import { Vector3 } from 'three';
import type { Match } from './Match';
import type { Effects } from '../rendering/Effects';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Hud } from '../ui/Hud';
import type { BuildView } from '../rendering/BuildView';
import type { CameraController } from '../camera/CameraController';
import type { CharacterModel } from '../rendering/CharacterModel';
import { WEAPONS } from '../weapons/weapons';
import { RARITY_INFO, itemLabel, itemRarity } from '../inventory/items';
import { escapeHtml } from '../ui/dom';
import type { Progression } from '../progression/Progression';
import type { QuestType } from '../quests/quests';

const MATERIAL_FX: Record<string, number> = { wood: 0xc08a55, stone: 0xa0a4a8, metal: 0xb8c6d4, dirt: 0x8a6d4a, concrete: 0xb0b0aa, glass: 0xcfefff, foliage: 0x5a8a3a };

/**
 * Translates simulation events into visual effects, audio, HUD feedback and
 * live quest progress. Pure presentation — never mutates the simulation.
 */
export class ClientEffects {
  private unsubs: (() => void)[] = [];
  private tmp = new Vector3();
  quests = true;

  constructor(
    match: Match,
    fx: Effects,
    audio: AudioEngine,
    hud: Hud,
    builds: BuildView,
    private camera: CameraController,
    private models: Map<number, CharacterModel>,
    progression: Progression,
    private now: () => number,
  ) {
    const ev = match.events;
    const humanId = match.human.id;
    const name = (id: number) => (id === humanId ? 'YOU' : match.byId(id)?.name ?? '???');
    const q = (type: QuestType, amount: number) => {
      if (!this.quests || match.mode.training) return;
      for (const quest of progression.questProgress(type, amount)) hud.xp(quest.rewardXP, `Quest: ${quest.title}`);
    };

    this.unsubs.push(
      ev.on('SHOT_FIRED', (e) => {
        const shooter = match.byId(e.shooterId);
        const model = this.models.get(e.shooterId);
        const from = model ? model.muzzlePosition(new Vector3()) : new Vector3(e.from.x, e.from.y, e.from.z);
        const to = new Vector3(e.to.x, e.to.y, e.to.z);
        const pellets = e.weapon === 'shotgun';
        fx.tracer(from, to, e.weapon === 'marksman' ? 0xbff4ff : 0xfff1b0, pellets ? 0.025 : e.weapon === 'marksman' ? 0.05 : 0.03);
        fx.flash(from, e.weapon === 'shotgun' ? 0.9 : 0.55);
        audio.weapon(e.weapon, shooter && e.shooterId !== humanId ? shooter.pos : undefined);
        if (e.shooterId === humanId) {
          const def = WEAPONS[e.weapon as keyof typeof WEAPONS];
          if (def) camera.addShake(def.id === 'shotgun' ? 0.35 : def.id === 'marksman' ? 0.3 : 0.06);
        }
      }),
      ev.on('IMPACT', (e) => {
        const color = MATERIAL_FX[e.material] ?? 0xcccccc;
        fx.burst(e.point, color, 4, 3, 0.18, 0.35, 12);
        if (e.shooterId === humanId || this.dist(e.point) < 30) audio.sfx('impact', e.point, 0.6);
      }),
      ev.on('PLAYER_DAMAGE', (e) => {
        const target = e.targetId >= 0 ? match.byId(e.targetId) : null;
        if (e.attackerId === humanId && e.targetId !== humanId) {
          const kill = !!target && !target.alive;
          hud.hitmarker(e.headshot, kill);
          audio.hitmarker(e.headshot, kill);
          if (e.amount > 0) hud.damageNumber(new Vector3(e.point.x, e.point.y, e.point.z), e.amount, e.headshot, e.shieldDamage > 0 && e.healthDamage === 0, this.now());
          if (target) {
            if (e.shieldDamage > 0 && target.shield <= 0) audio.sfx('shieldBreak', target.pos, 0.8);
            fx.burst(e.point, e.shieldDamage > 0 && e.healthDamage === 0 ? 0x6fc7ff : 0xff5a5a, 6, 3, 0.2, 0.3, 6);
          } else {
            fx.burst(e.point, 0xff6060, 10, 4, 0.25, 0.4, 6);
          }
          if (target && !match.mode.training) q('damage', e.amount);
          if (e.headshot && !match.mode.training) q('headshots', 1);
        }
        if (e.targetId === humanId) {
          const h = match.human;
          if (e.source === 'weapon' || e.source === 'pickaxe') {
            const attacker = match.byId(e.attackerId);
            if (attacker) {
              const ang = Math.atan2(attacker.pos.x - h.pos.x, attacker.pos.z - h.pos.z);
              const rel = -(ang - (camera.yaw + Math.PI));
              hud.damageFrom(rel);
            }
            camera.addShake(0.2);
          }
          audio.sfx(e.shieldDamage > 0 && e.healthDamage === 0 ? 'shieldHit' : 'hurt', undefined, 0.8);
        }
      }),
      ev.on('PLAYER_ELIMINATED', (e) => {
        const victim = match.byId(e.victimId);
        if (!victim) return;
        const vname = escapeHtml(name(e.victimId));
        let text: string;
        if (e.source === 'storm') text = `<b>${vname}</b> was lost in the storm`;
        else if (e.source === 'fall') text = `<b>${vname}</b> took a fatal fall`;
        else if (e.source === 'bounds') text = `<b>${vname}</b> left the map`;
        else text = `<b class="${e.killerId === humanId ? 'kf-you' : ''}">${escapeHtml(name(e.killerId))}</b> eliminated <b class="${e.victimId === humanId ? 'kf-you' : ''}">${vname}</b> <span class="kf-weapon">${e.weapon === 'pickaxe' ? 'PICKAXE' : WEAPONS[e.weapon as keyof typeof WEAPONS]?.short ?? ''}</span>`;
        hud.killfeed(text);
        fx.burst({ x: victim.pos.x, y: victim.pos.y + 1, z: victim.pos.z }, 0x9ef4ff, 40, 5, 0.35, 0.9, -1);
        if (e.killerId === humanId && e.victimId !== humanId) {
          hud.elimination(victim.name);
          if (!match.mode.training) {
            hud.xp(250, 'Elimination');
            q('eliminations', 1);
          }
        }
        if (e.victimId === humanId) audio.sfx('eliminated');
      }),
      ev.on('BUILD_PLACED', (e) => {
        builds.add(e.piece, this.now());
        const b = e.piece.bounds;
        const c = { x: (b.minX + b.maxX) / 2, y: b.minY + 0.2, z: (b.minZ + b.maxZ) / 2 };
        if (this.dist(c) < 60) {
          fx.burst(c, 0x9ff4ff, 8, 2.5, 0.25, 0.35, 2);
          audio.sfx('build', c, e.piece.ownerId === humanId ? 0.9 : 0.6, e.piece.material);
        }
        if (e.piece.ownerId === humanId && !match.mode.training) {
          q('builds', 1);
          if (!match.human.unlimitedMaterials) q('materialsUsed', 10);
        }
      }),
      ev.on('BUILD_DAMAGED', (e) => {
        if (e.point && this.dist(e.point) < 60) {
          fx.burst(e.point, MATERIAL_FX[e.piece.material], 3, 3, 0.2, 0.3, 10);
          audio.sfx('buildHit', e.point, 0.5, e.piece.material);
        }
      }),
      ev.on('BUILD_DESTROYED', (e) => {
        builds.remove(e.piece.id);
        if (e.reason === 'reset') return;
        const b = e.piece.bounds;
        const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 };
        if (this.dist(c) < 90) {
          fx.debris(c, MATERIAL_FX[e.piece.material], 10, 2.4, 0.3);
          fx.burst(c, 0xdddddd, 8, 2, 0.5, 0.6, 1);
          audio.sfx('buildBreak', c, 0.8);
        }
      }),
      ev.on('BUILD_EDITED', (e) => {
        builds.refresh(e.piece);
        const b = e.piece.bounds;
        if (e.byId === humanId) {
          audio.sfx('edit', undefined, 0.8);
          if (!match.mode.training) q('edits', 1);
        } else if (this.dist({ x: b.minX, y: b.minY, z: b.minZ }) < 40) audio.sfx('edit', { x: b.minX, y: b.minY, z: b.minZ }, 0.6);
      }),
      ev.on('BUILD_EDIT_RESET', (e) => {
        builds.refresh(e.piece);
        if (e.byId === humanId) audio.sfx('editReset', undefined, 0.8);
      }),
      ev.on('RESOURCE_HIT', (e) => {
        fx.burst(e.point, MATERIAL_FX[e.material] ?? 0xaaaaaa, 8, 4, 0.25, 0.45, 12);
        fx.debris(e.point, MATERIAL_FX[e.material] ?? 0xaaaaaa, e.destroyed ? 10 : 2, 0.6, 0.18);
        audio.sfx('harvest', e.combatantId === humanId ? undefined : e.point, 0.8, e.material);
        if (e.combatantId === humanId) {
          if (e.amount > 0) hud.pickup(`+${e.amount} ${e.material.toUpperCase()}`, '#d8c38a');
          if (!match.mode.training) q('materials', e.amount);
        }
      }),
      ev.on('ITEM_PICKED_UP', (e) => {
        if (e.combatantId !== humanId) return;
        audio.sfx('pickup');
        hud.pickup(itemLabel(e.item).toUpperCase(), RARITY_INFO[itemRarity(e.item)].color);
      }),
      ev.on('CHEST_OPENED', (e) => {
        fx.burst({ x: e.point.x, y: e.point.y + 0.8, z: e.point.z }, 0xffd36b, 24, 3, 0.3, 0.8, 2);
        audio.sfx('chest', e.point);
        if (e.combatantId === humanId && !match.mode.training) {
          hud.xp(40, 'Container opened');
          q('chests', 1);
        }
      }),
      ev.on('RELOAD_START', (e) => {
        const c = match.byId(e.combatantId);
        if (c) audio.sfx('reload', e.combatantId === humanId ? undefined : c.pos, 0.7);
      }),
      ev.on('RELOAD_END', (e) => {
        if (e.combatantId === humanId) audio.sfx('reloadEnd', undefined, 0.6);
      }),
      ev.on('WEAPON_SWITCH', (e) => {
        if (e.combatantId === humanId) audio.sfx('switch', undefined, 0.6);
      }),
      ev.on('PICKAXE_SWING', (e) => {
        const c = match.byId(e.combatantId);
        audio.weapon('pickaxe', e.combatantId === humanId ? undefined : c?.pos, 40);
      }),
      ev.on('JUMP', (e) => {
        if (e.combatantId === humanId) audio.sfx('jump', undefined, 0.5);
      }),
      ev.on('LANDED', (e) => {
        if (e.combatantId === humanId) {
          audio.sfx('land', undefined, Math.min(1, e.speed / 20 + 0.2));
          camera.landed(e.speed);
        }
      }),
      ev.on('GLIDER', (e) => {
        const c = match.byId(e.combatantId);
        if (c && (e.combatantId === humanId || this.dist(c.pos) < 60)) audio.sfx('glider', e.combatantId === humanId ? undefined : c.pos, 0.7);
      }),
      ev.on('DOOR_TOGGLED', (e) => audio.sfx('door', e.point, 0.8)),
      ev.on('ITEM_USED', (e) => {
        const c = match.byId(e.combatantId);
        if (c) {
          fx.burst({ x: c.pos.x, y: c.pos.y + 1, z: c.pos.z }, e.itemId === 'patch_kit' ? 0x7dff9a : 0x6fc7ff, 16, 2, 0.3, 0.8, -1);
          if (e.combatantId === humanId) audio.sfx('heal');
        }
      }),
      ev.on('POI_VISITED', (e) => {
        if (e.combatantId !== humanId) return;
        hud.banner(e.poi.toUpperCase(), match.mode.id === 'br' ? 'LOCATION DISCOVERED' : '', 2200);
        if (match.mode.id === 'br') {
          hud.xp(60, 'Location explored');
          q('visitPois', 1);
        }
      }),
      ev.on('NOTICE', (e) => hud.banner(e.text.toUpperCase(), '', 1400)),
    );
  }

  private dist(p: { x: number; y: number; z: number }): number {
    this.tmp.set(p.x, p.y, p.z);
    return this.tmp.distanceTo(this.camera.camera.position);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
  }
}
