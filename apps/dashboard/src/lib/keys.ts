/*
 * Single-key shortcuts must never fire while someone is typing, and never
 * with a modifier held (Ctrl A is select all).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return false;
}

export function isPlainKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey;
}

/** True while a modal dialog is open, so page shortcuts stay quiet behind it. */
export function modalOpen(): boolean {
  return Boolean(document.querySelector('[aria-modal="true"]'));
}
