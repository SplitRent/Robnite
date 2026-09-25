import type { WeaponId, ConsumableId } from '../inventory/items';
import type { BannerLook, CosmeticItem, OutfitLook, PickaxeLook, GliderLook, BackpackLook, WrapLook, LoadingLook, EmoteLook } from '../cosmetics/catalog';
import type { BuildPieceType } from '../building/grid';

/** Original inline SVG icons. */
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export const ICONS = {
  logo: `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ee7ff"/><stop offset="1" stop-color="#ff9d2e"/></linearGradient></defs><path d="M32 4 58 18v28L32 60 6 46V18Z" fill="none" stroke="url(#lg)" stroke-width="4"/><path d="M22 20h14a8 8 0 0 1 0 16h-6l10 10h-8l-10-10v10h-6V20Zm6 5v6h7a3 3 0 0 0 0-6Z" fill="url(#lg)"/></svg>`,
  credits: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ffb02e"/><circle cx="12" cy="12" r="7" fill="none" stroke="#7a4a00" stroke-width="1.6"/><path d="M14.5 9.2a3.4 3.4 0 1 0 0 5.6" fill="none" stroke="#7a4a00" stroke-width="2" stroke-linecap="round"/></svg>`,
  shield: `<svg viewBox="0 0 24 24"><path d="M12 2 20 5v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5Z" fill="currentColor"/></svg>`,
  heart: `<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11Z" fill="currentColor"/></svg>`,
  wood: `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" fill="#b98552"/><circle cx="17" cy="12" r="3" fill="#e0b27c" stroke="#7a4f28"/><path d="M4 9h10M4 13h9" stroke="#7a4f28"/></svg>`,
  stone: `<svg viewBox="0 0 24 24"><path d="M3 16 7 7l6-2 7 5 1 7-7 3H6Z" fill="#9aa0a6" stroke="#5f656b"/></svg>`,
  metal: `<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1" fill="#8da2b8" stroke="#4d5f73"/><circle cx="7" cy="8" r="1" fill="#e1e8ef"/><circle cx="17" cy="8" r="1" fill="#e1e8ef"/><circle cx="7" cy="16" r="1" fill="#e1e8ef"/><circle cx="17" cy="16" r="1" fill="#e1e8ef"/></svg>`,
  pickaxe: `<svg viewBox="0 0 24 24"><path d="M4 20 14 10" stroke="#8a5a35" stroke-width="2.4" stroke-linecap="round"/><path d="M8 5c5-2 9-1 12 3-3-1-6-1-9 1Z" fill="#c9d3dc"/></svg>`,
  gear: `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm9 4.8v-2.6l-2.4-.5a7 7 0 0 0-.7-1.7l1.4-2-1.9-1.9-2 1.4a7 7 0 0 0-1.7-.7L13.2 3h-2.6l-.5 2.4a7 7 0 0 0-1.7.7l-2-1.4-1.9 1.9 1.4 2a7 7 0 0 0-.7 1.7L3 10.7v2.6l2.4.5a7 7 0 0 0 .7 1.7l-1.4 2 1.9 1.9 2-1.4a7 7 0 0 0 1.7.7l.5 2.4h2.6l.5-2.4a7 7 0 0 0 1.7-.7l2 1.4 1.9-1.9-1.4-2a7 7 0 0 0 .7-1.7Z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  party: `<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3" fill="currentColor"/><circle cx="16" cy="8" r="3" fill="currentColor" opacity=".6"/><path d="M2 20c0-4 3-6 6-6s6 2 6 6Z" fill="currentColor"/><path d="M12 20c0-3 2-6 4-6s6 2 6 6Z" fill="currentColor" opacity=".6"/></svg>`,
  news: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" stroke-width="2"/></svg>`,
  code: `<svg viewBox="0 0 24 24"><path d="M3 8h18v8H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 12h2M11 12h2M15 12h2" stroke="currentColor" stroke-width="2"/></svg>`,
  bot: `<svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3" fill="currentColor"/><circle cx="9.5" cy="13" r="1.5" fill="#0b1220"/><circle cx="14.5" cy="13" r="1.5" fill="#0b1220"/><path d="M12 4v4" stroke="currentColor" stroke-width="2"/></svg>`,
};

export function weaponIcon(id: WeaponId | 'pickaxe', color = '#e9f1f7'): string {
  const paths: Record<string, string> = {
    ar: '<path d="M2 11h14l2-2h4v3h-3l-1 1H9l-1 4H5l1-4H2Z"/>',
    smg: '<path d="M4 9h12l1-1h3v3h-4v2h-3l-1 4H9l1-4H4Z"/>',
    shotgun: '<path d="M1 10h17l2-1h3v3h-5v1H11l-2 3H6l1-3H1Z"/>',
    marksman: '<path d="M1 11h13l1-3h4v2h4v2h-8l-1 1H9l-1 4H5l1-4H1Z"/><rect x="9" y="7" width="5" height="2"/>',
    pickaxe: '<path d="M5 20 15 10" stroke-width="2.4" stroke="currentColor"/><path d="M8 5c5-2 9-1 12 3-3-1-6-1-9 1Z"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="${color}" style="color:${color}">${paths[id]}</svg>`;
}

export function consumableIcon(id: ConsumableId): string {
  if (id === 'patch_kit') return `<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2" fill="#e8434b"/><path d="M12 9v6M9 12h6" stroke="#fff" stroke-width="2.4"/></svg>`;
  const tall = id === 'shield_canister';
  return `<svg viewBox="0 0 24 24"><rect x="${tall ? 7 : 8}" y="${tall ? 3 : 7}" width="${tall ? 10 : 8}" height="${tall ? 18 : 12}" rx="3" fill="#3f9dff"/><rect x="${tall ? 9 : 10}" y="${tall ? 6 : 9}" width="2" height="${tall ? 12 : 8}" fill="#bfe3ff"/></svg>`;
}

export function pieceIcon(p: BuildPieceType): string {
  const s = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"';
  switch (p) {
    case 'wall':
      return `<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" ${s}/><path d="M5 12h14M12 4v16" stroke="currentColor" opacity=".5"/></svg>`;
    case 'floor':
      return `<svg viewBox="0 0 24 24"><path d="M3 14 12 9l9 5-9 5Z" ${s}/></svg>`;
    case 'ramp':
      return `<svg viewBox="0 0 24 24"><path d="M3 19h18V6Z" ${s}/></svg>`;
    case 'cone':
      return `<svg viewBox="0 0 24 24"><path d="M3 17 12 6l9 11Z" ${s}/><path d="M12 6v11" stroke="currentColor" opacity=".5"/></svg>`;
  }
}

export function bannerSvg(look: BannerLook, size = 48): string {
  const f = look.fg;
  const icons: Record<BannerLook['icon'], string> = {
    summit: `<path d="M8 40 22 18l6 9 5-6 11 19Z" fill="${f}"/>`,
    picks: `<path d="M12 40 36 16M36 40 12 16" stroke="${f}" stroke-width="4"/><path d="M8 18c6-6 12-6 12-6M40 18c-6-6-12-6-12-6" stroke="${f}" stroke-width="3" fill="none"/>`,
    eye: `<ellipse cx="24" cy="28" rx="16" ry="9" fill="none" stroke="${f}" stroke-width="3"/><circle cx="24" cy="28" r="5" fill="${f}"/>`,
    bolt: `<path d="M27 8 12 30h10l-3 14 17-24H26Z" fill="${f}"/>`,
    crown: `<path d="M8 36V16l9 9 7-12 7 12 9-9v20Z" fill="${f}"/>`,
    skull: `<path d="M24 10c-9 0-14 6-14 13 0 5 3 8 5 9v6h18v-6c2-1 5-4 5-9 0-7-5-13-14-13Z" fill="${f}"/><circle cx="19" cy="24" r="3.5" fill="#000"/><circle cx="29" cy="24" r="3.5" fill="#000"/>`,
    tree: `<path d="M24 8 12 26h7l-9 12h28l-9-12h7Z" fill="${f}"/><rect x="22" y="38" width="4" height="4" fill="${f}"/>`,
    grid: `<path d="M10 14h28M10 24h28M10 34h28M14 10v28M24 10v28M34 10v28" stroke="${f}" stroke-width="2.5"/>`,
    flame: `<path d="M24 8c4 8 12 11 12 21a12 12 0 0 1-24 0c0-6 4-8 5-13 3 3 3 6 3 6s5-6 4-14Z" fill="${f}"/>`,
    star: `<path d="m24 8 4.7 10 11 1.2-8.2 7.4 2.3 10.9L24 32l-9.8 5.5 2.3-10.9-8.2-7.4 11-1.2Z" fill="${f}"/>`,
  };
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}"><rect width="48" height="48" rx="8" fill="${look.bg}"/>${icons[look.icon]}</svg>`;
}

/** Preview art for any cosmetic (original vector silhouettes coloured by the item). */
export function cosmeticPreview(item: CosmeticItem): string {
  switch (item.category) {
    case 'outfit': {
      const l = item.look as OutfitLook;
      const w = l.body === 'a' ? 34 : 30;
      const x = 50 - w / 2;
      const head = l.head === 'helmet' || l.head === 'hood' ? `<rect x="36" y="10" width="28" height="26" rx="6" fill="${hex(l.secondary)}"/>` : l.head === 'cap' ? `<rect x="37" y="10" width="26" height="9" rx="3" fill="${hex(l.primary)}"/><rect x="31" y="16" width="14" height="4" rx="2" fill="${hex(l.accent)}"/>` : l.head === 'crown' ? `<path d="M38 14l4-6 4 6 4-6 4 6 4-6 4 6v4H38Z" fill="${hex(l.accent)}"/>` : l.head === 'beanie' ? `<rect x="37" y="9" width="26" height="11" rx="5" fill="${hex(l.accent)}"/>` : `<rect x="38" y="12" width="24" height="7" rx="3" fill="${hex(l.hair)}"/>`;
      const visor = l.head === 'visor' || l.head === 'goggles' ? `<rect x="39" y="22" width="22" height="5" rx="2" fill="${hex(l.accent)}"/>` : l.head === 'mask' ? `<rect x="39" y="26" width="22" height="7" rx="2" fill="#1a1d22"/>` : `<rect x="43" y="23" width="4" height="4" fill="#1a1d22"/><rect x="53" y="23" width="4" height="4" fill="#1a1d22"/>`;
      return `<svg viewBox="0 0 100 120" class="preview-svg">
        <rect x="40" y="14" width="20" height="22" rx="4" fill="${hex(l.skin)}"/>${head}${visor}
        <rect x="${x}" y="38" width="${w}" height="34" rx="5" fill="${hex(l.primary)}"/>
        <rect x="${x + 4}" y="46" width="${w - 8}" height="5" rx="2" fill="${hex(l.accent)}" ${l.glow ? 'filter="url(#glow)"' : ''}/>
        <rect x="${x - 10}" y="40" width="9" height="30" rx="4" fill="${hex(l.primary)}"/>
        <rect x="${x + w + 1}" y="40" width="9" height="30" rx="4" fill="${hex(l.primary)}"/>
        <rect x="${x + 1}" y="72" width="${w / 2 - 2}" height="36" rx="4" fill="${hex(l.secondary)}"/>
        <rect x="${50 + 1}" y="72" width="${w / 2 - 2}" height="36" rx="4" fill="${hex(l.secondary)}"/>
        <rect x="${x}" y="68" width="${w}" height="5" fill="${hex(l.accent)}"/>
        <defs><filter id="glow"><feGaussianBlur stdDeviation="1.5"/></filter></defs></svg>`;
    }
    case 'pickaxe': {
      const l = item.look as PickaxeLook;
      const head = l.shape === 'axe' ? `<path d="M58 22c10 0 18 8 18 18l-18-4Z" fill="${hex(l.head)}"/>` : l.shape === 'hammer' ? `<rect x="48" y="16" width="30" height="16" rx="3" fill="${hex(l.head)}"/>` : l.shape === 'scythe' ? `<path d="M56 24c14-8 30 0 30 12-8-8-20-8-28-4Z" fill="${hex(l.head)}"/>` : `<path d="M34 30c16-14 38-14 50 2-16-6-32-6-50-2Z" fill="${hex(l.head)}"/>`;
      return `<svg viewBox="0 0 100 100" class="preview-svg"><path d="M22 86 62 30" stroke="${hex(l.handle)}" stroke-width="7" stroke-linecap="round"/>${head}</svg>`;
    }
    case 'glider': {
      const l = item.look as GliderLook;
      const shape = l.shape === 'chute' ? `<path d="M10 50c0-24 80-24 80 0-12-6-26-8-40-8s-28 2-40 8Z" fill="${hex(l.color)}"/><path d="M22 46c10-3 46-3 56 0" stroke="${hex(l.color2)}" stroke-width="4" fill="none"/>` : l.shape === 'wing' ? `<path d="M6 44 50 30l44 14-44 6Z" fill="${hex(l.color)}"/><path d="M6 44l44-6 44 6" stroke="${hex(l.color2)}" stroke-width="4" fill="none"/>` : `<path d="M50 20 90 56H10Z" fill="${hex(l.color)}"/><path d="M26 52h48" stroke="${hex(l.color2)}" stroke-width="5"/>`;
      return `<svg viewBox="0 0 100 100" class="preview-svg">${shape}<path d="M30 52 50 82 70 52" stroke="#ccc" fill="none"/><circle cx="50" cy="84" r="5" fill="#ddd"/></svg>`;
    }
    case 'backpack': {
      const l = item.look as BackpackLook;
      if (l.shape === 'none') return `<svg viewBox="0 0 100 100" class="preview-svg"><circle cx="50" cy="50" r="26" fill="none" stroke="#56606b" stroke-width="5"/><path d="M32 68 68 32" stroke="#56606b" stroke-width="5"/></svg>`;
      return `<svg viewBox="0 0 100 100" class="preview-svg"><rect x="28" y="22" width="44" height="58" rx="10" fill="${hex(l.color)}"/><rect x="34" y="50" width="32" height="18" rx="4" fill="${hex(l.color2)}"/>${l.shape === 'antenna' ? `<path d="M60 22V6" stroke="${hex(l.color)}" stroke-width="3"/><circle cx="60" cy="6" r="4" fill="${hex(l.color2)}"/>` : ''}${l.shape === 'core' || l.shape === 'cell' ? `<circle cx="50" cy="38" r="9" fill="${hex(l.color2)}"/>` : ''}</svg>`;
    }
    case 'wrap': {
      const l = item.look as WrapLook;
      return `<svg viewBox="0 0 100 100" class="preview-svg"><defs><linearGradient id="w${item.id}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${hex(l.color)}"/><stop offset="1" stop-color="${hex(l.color2)}"/></linearGradient></defs><path d="M8 46h52l6-6h18v10h-12l-4 4H34l-4 16H20l4-16H8Z" fill="url(#w${item.id})" stroke="rgba(255,255,255,.25)"/></svg>`;
    }
    case 'emote': {
      const anim = (item.look as EmoteLook).anim;
      const arms: Record<string, string> = {
        wave: 'M36 44 26 30M64 44 76 26', victory: 'M36 44 30 60M64 44 76 22', point: 'M36 44 30 60M64 44 88 44', dance: 'M36 44 22 36M64 44 78 56',
        celebrate: 'M36 44 26 20M64 44 74 20', thumbs: 'M36 44 30 60M64 44 72 30', salute: 'M36 44 30 60M64 44 56 22', robot: 'M36 44 22 44M64 44 64 60', spin: 'M36 44 18 44M64 44 82 44',
      };
      return `<svg viewBox="0 0 100 100" class="preview-svg"><circle cx="50" cy="26" r="10" fill="#e8f4ff"/><rect x="38" y="38" width="24" height="28" rx="6" fill="#5ee7ff"/><path d="${arms[anim]}" stroke="#5ee7ff" stroke-width="7" stroke-linecap="round"/><path d="M44 66 40 90M56 66 60 90" stroke="#3a4a5c" stroke-width="8" stroke-linecap="round"/></svg>`;
    }
    case 'banner':
      return bannerSvg(item.look as BannerLook, 96);
    case 'loading': {
      const l = item.look as LoadingLook;
      return `<svg viewBox="0 0 160 90" class="preview-svg"><defs><linearGradient id="ld${item.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l.from}"/><stop offset="1" stop-color="${l.to}"/></linearGradient></defs><rect width="160" height="90" rx="6" fill="url(#ld${item.id})"/><path d="M0 70 30 48l20 12 30-26 30 22 20-10 30 24v20H0Z" fill="rgba(0,0,0,.45)"/></svg>`;
    }
  }
}
