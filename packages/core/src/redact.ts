const KEY_PATTERNS = [/sk-ant-[A-Za-z0-9_-]+/g, /\b\d{9,10}:[A-Za-z0-9_-]{30,}\b/g /* telegram bot tokens */];

/**
 * Replaces every known secret, and anything shaped like an Anthropic key or a
 * Telegram bot token, with "[redacted]". Walks objects and arrays. Every log
 * line and every API response goes through this.
 */
export function redact<T>(value: T, secrets: string[] = []): T {
  const list = secrets.filter((s) => typeof s === 'string' && s.length > 5).sort((a, b) => b.length - a.length);
  const seen = new WeakMap<object, unknown>();

  const scrub = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let out = v;
      for (const s of list) out = out.split(s).join('[redacted]');
      for (const re of KEY_PATTERNS) out = out.replace(re, '[redacted]');
      return out;
    }
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return v;
    if (seen.has(v)) return seen.get(v);
    if (Array.isArray(v)) {
      const arr: unknown[] = [];
      seen.set(v, arr);
      for (const item of v) arr.push(scrub(item));
      return arr;
    }
    if (v instanceof Error) {
      return { name: v.name, message: scrub(v.message), stack: scrub(v.stack) };
    }
    const obj: Record<string, unknown> = {};
    seen.set(v, obj);
    for (const [k, val] of Object.entries(v)) obj[k] = scrub(val);
    return obj;
  };

  return scrub(value) as T;
}
