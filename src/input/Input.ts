import type { ActionId, KeybindConfig } from './bindings';

type CaptureFn = (code: string) => void;

/**
 * Keyboard + mouse input with rebindable actions, pointer lock, per-frame
 * edge detection and a capture mode for the rebinding UI.
 */
export class Input {
  private down = new Set<string>();
  private pressedCodes = new Set<string>();
  private releasedCodes = new Set<string>();
  private framePressed = new Set<string>();
  private frameReleased = new Set<string>();
  private capture: CaptureFn | null = null;
  mouseDX = 0;
  mouseDY = 0;
  private accX = 0;
  private accY = 0;
  enabled = false;
  rawInput = true;
  /** Called when pointer lock is lost while playing (opens the pause menu). */
  onUnlock: (() => void) | null = null;
  onBlur: (() => void) | null = null;
  private disposers: (() => void)[] = [];

  constructor(private target: HTMLElement, public bindings: KeybindConfig) {
    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(t, fn, opts);
      this.disposers.push(() => window.removeEventListener(t, fn, opts));
    };
    on('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        this.finishCapture(e.code);
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (this.enabled && (this.isBound(e.code) || e.code === 'Tab' || e.code === 'Space')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedCodes.add(e.code);
      this.down.add(e.code);
    });
    on('keyup', (e) => {
      if (this.down.has(e.code)) this.releasedCodes.add(e.code);
      this.down.delete(e.code);
    });
    on('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      if (this.capture) {
        e.preventDefault();
        this.finishCapture(code);
        return;
      }
      if (!this.enabled) return;
      if (!this.locked) return;
      this.pressedCodes.add(code);
      this.down.add(code);
    });
    on('mouseup', (e) => {
      const code = `Mouse${e.button}`;
      if (this.down.has(code)) this.releasedCodes.add(code);
      this.down.delete(code);
    });
    on('wheel', (e) => {
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      if (this.capture) {
        e.preventDefault();
        this.finishCapture(code);
        return;
      }
      if (!this.enabled || !this.locked) return;
      this.pressedCodes.add(code);
      this.releasedCodes.add(code);
    }, { passive: false });
    on('mousemove', (e) => {
      if (!this.enabled || !this.locked) return;
      this.accX += e.movementX;
      this.accY += e.movementY;
    });
    on('contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });
    on('blur', () => {
      this.clear();
      this.onBlur?.();
    });
    const lockChange = () => {
      if (!this.locked) {
        for (const c of [...this.down]) if (c.startsWith('Mouse')) this.down.delete(c);
        if (this.enabled) this.onUnlock?.();
      }
    };
    document.addEventListener('pointerlockchange', lockChange);
    this.disposers.push(() => document.removeEventListener('pointerlockchange', lockChange));
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  async lock(): Promise<void> {
    if (this.locked) return;
    try {
      const el = this.target as HTMLElement & { requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void };
      const r = el.requestPointerLock(this.rawInput ? { unadjustedMovement: true } : undefined);
      if (r && typeof (r as Promise<void>).catch === 'function') {
        await (r as Promise<void>).catch(async () => {
          // unadjustedMovement unsupported → plain lock.
          await Promise.resolve(el.requestPointerLock());
        });
      }
    } catch {
      /* Pointer lock can fail without a user gesture; the UI prompts to click. */
    }
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  private isBound(code: string): boolean {
    for (const codes of Object.values(this.bindings)) if (codes.includes(code)) return true;
    return false;
  }

  /** Latch edges and mouse deltas for this frame. */
  beginFrame(): void {
    this.framePressed = this.pressedCodes;
    this.frameReleased = this.releasedCodes;
    this.pressedCodes = new Set();
    this.releasedCodes = new Set();
    this.mouseDX = this.accX;
    this.mouseDY = this.accY;
    this.accX = 0;
    this.accY = 0;
  }

  held(action: ActionId): boolean {
    for (const c of this.bindings[action] ?? []) if (this.down.has(c)) return true;
    return false;
  }

  pressed(action: ActionId): boolean {
    for (const c of this.bindings[action] ?? []) if (this.framePressed.has(c)) return true;
    return false;
  }

  released(action: ActionId): boolean {
    for (const c of this.bindings[action] ?? []) if (this.frameReleased.has(c)) return true;
    return false;
  }

  /** Was this specific code pressed (used for context-sensitive keys). */
  codePressed(code: string): boolean {
    return this.framePressed.has(code);
  }

  clear(): void {
    this.down.clear();
    this.pressedCodes.clear();
    this.releasedCodes.clear();
    this.accX = 0;
    this.accY = 0;
  }

  /** Rebinding: capture the next key / mouse button / wheel. */
  captureNext(fn: CaptureFn): void {
    this.capture = fn;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  private finishCapture(code: string): void {
    const fn = this.capture;
    this.capture = null;
    fn?.(code);
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
