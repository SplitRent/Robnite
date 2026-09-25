import { h, clear } from '../ui/dom';
import type { Match } from './Match';
import { codeLabel, type KeybindConfig } from '../input/bindings';

interface Step {
  id: string;
  title: string;
  hint: (k: (a: keyof KeybindConfig) => string) => string;
}

export const TUTORIAL_STEPS: Step[] = [
  { id: 'move', title: 'Move', hint: (k) => `Use ${k('forward')} ${k('left')} ${k('backward')} ${k('right')} to move. Hold ${k('sprint')} to sprint.` },
  { id: 'aim', title: 'Aim', hint: () => 'Move the mouse to look around.' },
  { id: 'shoot', title: 'Shoot', hint: (k) => `Press ${k('fire')} to fire. Hit a target at the AIM PRACTICE station ahead.` },
  { id: 'switch', title: 'Switch weapon', hint: (k) => `Press ${k('slot1')}–${k('slot5')} or scroll to switch weapons.` },
  { id: 'wall', title: 'Build a wall', hint: (k) => `Press ${k('wall')} for Wall, aim where you want it and press ${k('fire')}. The ghost shows exactly where it goes.` },
  { id: 'ramp', title: 'Build a ramp', hint: (k) => `Press ${k('ramp')} for Ramp and place it with ${k('fire')}.` },
  { id: 'edit', title: 'Edit a wall', hint: (k) => `Look at your wall, press ${k('edit')}, drag across tiles with ${k('fire')} and release to confirm.` },
  { id: 'shootEdit', title: 'Shoot through the edit', hint: () => 'Fire through the opening you made — hit a target or a dummy.' },
  { id: 'harvest', title: 'Harvest resources', hint: (k) => `Press ${k('pickaxe')} for the pickaxe and hit a tree or rock.` },
  { id: 'inventory', title: 'Open inventory', hint: (k) => `Press ${k('inventory')} to view your inventory.` },
  { id: 'done', title: 'Start Battle Royale', hint: () => 'You are ready. Open the menu (ESC) and choose “FINISH TUTORIAL” to drop into Hollow Ridge.' },
];

/** Tracks tutorial progress from real gameplay events. */
export class Tutorial {
  index = 0;
  readonly el: HTMLElement;
  private unsubs: (() => void)[] = [];
  private moved = 0;
  private looked = 0;
  private lastPos: { x: number; z: number } | null = null;
  private editedAt = -1;
  onComplete: (() => void) | null = null;

  constructor(parent: HTMLElement, private match: Match, private bindings: KeybindConfig) {
    this.el = h('div', { class: 'tutorial panel-glass' });
    parent.appendChild(this.el);
    const ev = match.events;
    const me = match.human.id;
    this.unsubs.push(
      ev.on('SHOT_FIRED', (e) => {
        if (e.shooterId === me && this.cur === 'shoot') this.next();
      }),
      ev.on('PLAYER_DAMAGE', (e) => {
        if (e.attackerId !== me) return;
        if (this.cur === 'shoot') this.next();
        if (this.cur === 'shootEdit' && this.editedAt >= 0) this.next();
      }),
      ev.on('WEAPON_SWITCH', (e) => {
        if (e.combatantId === me && this.cur === 'switch') this.next();
      }),
      ev.on('BUILD_PLACED', (e) => {
        if (e.piece.ownerId !== me) return;
        if (this.cur === 'wall' && e.piece.type === 'wall') this.next();
        else if (this.cur === 'ramp' && e.piece.type === 'ramp') this.next();
      }),
      ev.on('BUILD_EDITED', (e) => {
        if (e.byId !== me) return;
        this.editedAt = match.time;
        if (this.cur === 'edit') this.next();
      }),
      ev.on('RESOURCE_HIT', (e) => {
        if (e.combatantId === me && this.cur === 'harvest') this.next();
      }),
    );
    this.render();
  }

  get cur(): string {
    return TUTORIAL_STEPS[this.index]?.id ?? 'done';
  }

  next(): void {
    if (this.index < TUTORIAL_STEPS.length - 1) {
      this.index++;
      this.render();
      this.el.classList.remove('pop');
      void this.el.offsetWidth;
      this.el.classList.add('pop');
    }
  }

  skipStep(): void {
    this.next();
  }

  /** Called every frame with look delta (radians) and inventory state. */
  update(lookDelta: number, inventoryOpen: boolean): void {
    const p = this.match.human.pos;
    if (this.lastPos) this.moved += Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.lastPos = { x: p.x, z: p.z };
    this.looked += Math.abs(lookDelta);
    if (this.cur === 'move' && this.moved > 6) this.next();
    if (this.cur === 'aim' && this.looked > 2.5) this.next();
    if (this.cur === 'inventory' && inventoryOpen) this.next();
  }

  private render(): void {
    clear(this.el);
    const k = (a: keyof KeybindConfig) => `[${codeLabel(this.bindings[a]?.[0])}]`;
    const step = TUTORIAL_STEPS[this.index];
    this.el.append(
      h('div', { class: 'tutorial-count' }, `TUTORIAL · ${this.index + 1} / ${TUTORIAL_STEPS.length}`),
      h('div', { class: 'tutorial-title' }, step.title.toUpperCase()),
      h('div', { class: 'tutorial-hint' }, step.hint(k)),
      h('div', { class: 'tutorial-steps' }, TUTORIAL_STEPS.map((_s, i) => h('i', { class: i < this.index ? 'done' : i === this.index ? 'cur' : '' }))),
      h('div', { class: 'tutorial-skip' }, 'ESC → Skip step / Skip tutorial'),
    );
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.el.remove();
  }
}
