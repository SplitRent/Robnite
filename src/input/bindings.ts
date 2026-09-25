/** Rebindable actions and their defaults. Codes are KeyboardEvent.code, "Mouse0-4" or "WheelUp/WheelDown". */
export type ActionId =
  | 'forward' | 'backward' | 'left' | 'right' | 'jump' | 'sprint' | 'crouch'
  | 'fire' | 'aim' | 'reload' | 'pickaxe' | 'nextWeapon' | 'prevWeapon'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
  | 'wall' | 'floor' | 'ramp' | 'roof' | 'edit' | 'rotate' | 'resetEdit' | 'cycleMaterial' | 'toggleBuild'
  | 'interact' | 'inventory' | 'map' | 'emote' | 'menu'
  | 'practiceReset' | 'practiceRespawn';

export interface ActionInfo {
  id: ActionId;
  label: string;
  group: 'Movement' | 'Combat' | 'Building' | 'UI' | 'Practice';
}

export const ACTIONS: ActionInfo[] = [
  { id: 'forward', label: 'Forward', group: 'Movement' },
  { id: 'backward', label: 'Backward', group: 'Movement' },
  { id: 'left', label: 'Left', group: 'Movement' },
  { id: 'right', label: 'Right', group: 'Movement' },
  { id: 'jump', label: 'Jump', group: 'Movement' },
  { id: 'sprint', label: 'Sprint', group: 'Movement' },
  { id: 'crouch', label: 'Crouch / Slide', group: 'Movement' },
  { id: 'fire', label: 'Fire / Place', group: 'Combat' },
  { id: 'aim', label: 'Aim', group: 'Combat' },
  { id: 'reload', label: 'Reload', group: 'Combat' },
  { id: 'pickaxe', label: 'Pickaxe', group: 'Combat' },
  { id: 'nextWeapon', label: 'Next Weapon', group: 'Combat' },
  { id: 'prevWeapon', label: 'Previous Weapon', group: 'Combat' },
  { id: 'slot1', label: 'Slot 1', group: 'Combat' },
  { id: 'slot2', label: 'Slot 2', group: 'Combat' },
  { id: 'slot3', label: 'Slot 3', group: 'Combat' },
  { id: 'slot4', label: 'Slot 4', group: 'Combat' },
  { id: 'slot5', label: 'Slot 5', group: 'Combat' },
  { id: 'wall', label: 'Wall', group: 'Building' },
  { id: 'floor', label: 'Floor', group: 'Building' },
  { id: 'ramp', label: 'Ramp', group: 'Building' },
  { id: 'roof', label: 'Roof / Cone', group: 'Building' },
  { id: 'edit', label: 'Edit', group: 'Building' },
  { id: 'rotate', label: 'Rotate', group: 'Building' },
  { id: 'resetEdit', label: 'Reset Edit', group: 'Building' },
  { id: 'cycleMaterial', label: 'Change Material', group: 'Building' },
  { id: 'toggleBuild', label: 'Toggle Build Mode', group: 'Building' },
  { id: 'interact', label: 'Interact', group: 'UI' },
  { id: 'inventory', label: 'Inventory', group: 'UI' },
  { id: 'map', label: 'Map & Scoreboard', group: 'UI' },
  { id: 'emote', label: 'Emote', group: 'UI' },
  { id: 'menu', label: 'Menu', group: 'UI' },
  { id: 'practiceReset', label: 'Reset Builds (Practice)', group: 'Practice' },
  { id: 'practiceRespawn', label: 'Respawn (Practice)', group: 'Practice' },
];

export type KeybindConfig = Record<ActionId, string[]>;

export const DEFAULT_BINDINGS: KeybindConfig = {
  forward: ['KeyW'],
  backward: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  sprint: ['ShiftLeft'],
  crouch: ['ControlLeft'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  reload: ['KeyR'],
  pickaxe: ['KeyF'],
  nextWeapon: ['WheelDown'],
  prevWeapon: ['WheelUp'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  wall: ['KeyZ'],
  floor: ['KeyX'],
  ramp: ['KeyC'],
  roof: ['KeyV'],
  edit: ['KeyE'],
  rotate: ['KeyR'],
  resetEdit: ['KeyR', 'Mouse2'],
  cycleMaterial: ['KeyT'],
  toggleBuild: ['KeyQ'],
  interact: ['KeyE'],
  inventory: ['Tab'],
  map: ['KeyM'],
  emote: ['KeyB'],
  menu: ['Escape'],
  practiceReset: ['KeyH'],
  practiceRespawn: ['KeyJ'],
};

/**
 * Pairs that intentionally share keys — the game decides by context
 * (e.g. R reloads normally, rotates in build mode, resets in edit mode).
 */
const CONTEXTUAL = [
  ['reload', 'rotate', 'resetEdit'],
  ['edit', 'interact'],
  ['aim', 'resetEdit'],
] as ActionId[][];

export function isContextualPair(a: ActionId, b: ActionId): boolean {
  return CONTEXTUAL.some((g) => g.includes(a) && g.includes(b));
}

/** Actions (other than `action`) that already use `code`, excluding contextual pairs. */
export function findConflicts(bindings: KeybindConfig, action: ActionId, code: string): ActionId[] {
  const out: ActionId[] = [];
  for (const a of ACTIONS) {
    if (a.id === action) continue;
    if (bindings[a.id]?.includes(code) && !isContextualPair(a.id, action)) out.push(a.id);
  }
  return out;
}

export function codeLabel(code: string | undefined): string {
  if (!code) return '—';
  const map: Record<string, string> = {
    Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'MOUSE 4', Mouse4: 'MOUSE 5',
    WheelUp: 'WHEEL UP', WheelDown: 'WHEEL DOWN', Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT', Escape: 'ESC', Tab: 'TAB',
    CapsLock: 'CAPS', Enter: 'ENTER', Backspace: 'BKSP', Backquote: '`',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  return code.toUpperCase();
}
