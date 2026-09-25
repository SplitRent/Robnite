import { h, clear } from './dom';
import type { AudioEngine } from '../audio/AudioEngine';

/**
 * Toasts (bounded queue, auto-dismiss) and modal dialogs.
 */
export class Overlay {
  private toastBox: HTMLElement;
  private modalRoot: HTMLElement;
  private toasts: HTMLElement[] = [];
  private static MAX_TOASTS = 4;

  constructor(root: HTMLElement, private audio: AudioEngine | null) {
    this.toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.modalRoot = h('div', { class: 'modal-root' });
    root.append(this.toastBox, this.modalRoot);
  }

  toast(title: string, body = '', kind: 'info' | 'good' | 'warn' | 'xp' | 'level' = 'info', ms = 2800): void {
    // Merge an identical recent toast instead of stacking duplicates.
    const dup = this.toasts.find((t) => t.dataset.key === title + body);
    if (dup) {
      dup.classList.remove('show');
      void dup.offsetWidth;
      dup.classList.add('show');
      return;
    }
    const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, h('div', { class: 'toast-title' }, title), body ? h('div', { class: 'toast-body' }, body) : null);
    el.dataset.key = title + body;
    this.toastBox.appendChild(el);
    this.toasts.push(el);
    while (this.toasts.length > Overlay.MAX_TOASTS) this.toasts.shift()!.remove();
    requestAnimationFrame(() => el.classList.add('show'));
    if (kind === 'level') this.audio?.ui('levelup');
    else this.audio?.ui('toast');
    setTimeout(() => {
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(() => {
        el.remove();
        this.toasts = this.toasts.filter((t) => t !== el);
      }, 350);
    }, ms);
  }

  /** Generic modal. Resolves with the id of the pressed button (or null if dismissed). */
  modal(opts: { title: string; body?: string | HTMLElement; buttons: { id: string; label: string; kind?: 'primary' | 'danger' | 'ghost' }[]; dismissable?: boolean; className?: string }): Promise<string | null> {
    return new Promise((resolve) => {
      const close = (id: string | null) => {
        backdrop.classList.remove('show');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(() => backdrop.remove(), 180);
        this.audio?.ui('close');
        resolve(id);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && opts.dismissable !== false) {
          e.stopPropagation();
          close(null);
        }
      };
      const body = typeof opts.body === 'string' ? h('p', { class: 'modal-text' }, opts.body) : opts.body ?? null;
      const card = h(
        'div',
        { class: `modal ${opts.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
        h('h2', { class: 'modal-title' }, opts.title),
        body,
        h('div', { class: 'modal-actions' }, opts.buttons.map((b) => h('button', { class: `btn ${b.kind === 'primary' ? 'btn-primary' : b.kind === 'danger' ? 'btn-danger' : 'btn-ghost'}`, onclick: () => close(b.id) }, b.label))),
      );
      const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => { if (e.target === backdrop && opts.dismissable !== false) close(null); } }, card);
      this.modalRoot.appendChild(backdrop);
      document.addEventListener('keydown', onKey, true);
      requestAnimationFrame(() => backdrop.classList.add('show'));
      this.audio?.ui('open');
      (card.querySelector('.btn-primary') as HTMLElement | null)?.focus();
    });
  }

  confirm(title: string, body: string, ok = 'CONFIRM', danger = false): Promise<boolean> {
    return this.modal({ title, body, buttons: [{ id: 'cancel', label: 'CANCEL', kind: 'ghost' }, { id: 'ok', label: ok, kind: danger ? 'danger' : 'primary' }] }).then((r) => r === 'ok');
  }

  clearModals(): void {
    clear(this.modalRoot);
  }

  get hasModal(): boolean {
    return this.modalRoot.childElementCount > 0;
  }
}
