/*
 * The entry script (10 KB budget). The page is complete before this runs;
 * this adds the controls and the small live parts: the theme and Motion
 * toggles, nav state and the progress rail, reveals, the sample feed, the
 * How-it-works steps, the inbox keyboard demo, the terminal transcript, copy
 * buttons and the sources marquee. After `load` and an idle moment it loads
 * motion.ts (GSAP) and, when the gate passes, the 3D stage.
 *
 * Nothing here runs requestAnimationFrame. Moving parts are CSS transitions
 * started by timers and observers, so at rest the page does no work.
 */
import { emit } from './stage/events';
import type { StageHandle } from './stage/index';

const root = document.documentElement;
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];
const motionOn = () => !root.classList.contains('motion-off');
const store = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // Storage refused. The choice still applies to this page view.
  }
};
const once = (el: Element | null, fn: () => void, threshold = 0.3) => {
  if (!el) return;
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) {
      io.disconnect();
      fn();
    }
  }, { threshold });
  io.observe(el);
};
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stillsQuery = /[?&]stills=(\d)(p?)/.exec(location.search);

/* ---------- Theme: the owner's toggle, key nlpf-theme ---------- */

const media = matchMedia('(prefers-color-scheme: dark)');
const themeBtn = $<HTMLButtonElement>('#theme');
const isDark = () => root.dataset.theme === 'dark' || (root.dataset.theme === undefined && media.matches);
const syncTheme = () => themeBtn?.setAttribute('aria-pressed', String(isDark()));
themeBtn?.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  const flip = () => {
    root.dataset.theme = next;
    store('nlpf-theme', next);
    syncTheme();
    dispatchEvent(new Event('nlpf:theme'));
  };
  // A circular reveal from the button where view transitions exist; an instant switch elsewhere.
  const r = themeBtn.getBoundingClientRect();
  root.style.setProperty('--vt-x', `${r.left + r.width / 2}px`);
  root.style.setProperty('--vt-y', `${r.top + r.height / 2}px`);
  if (motionOn() && 'startViewTransition' in document) document.startViewTransition(flip);
  else flip();
});
// Only moves the button while the visitor is on system: an explicit choice outranks the system flipping underneath it.
media.addEventListener('change', syncTheme);
syncTheme();

/* ---------- Motion toggle, key nlpf-motion ---------- */

let stage: StageHandle | null = null;
const motionBtns = $$<HTMLButtonElement>('[data-motion]');
const syncMotion = () => {
  for (const b of motionBtns) {
    b.setAttribute('aria-pressed', String(motionOn()));
    const s = $('[data-motion-state]', b);
    if (s) s.textContent = motionOn() ? 'on' : 'off';
  }
};
for (const b of motionBtns) {
  b.addEventListener('click', () => {
    const on = !motionOn();
    root.classList.toggle('motion-off', !on);
    store('nlpf-motion', on ? 'on' : 'off');
    syncMotion();
    if (on) {
      loadMotion();
      if (stage) stage.resume();
      else maybeStage();
    } else {
      stage?.stop();
      root.classList.remove('stage-likely', 'stage-intro');
      finishFeed();
      finishTerm();
    }
  });
}
syncMotion();

/* ---------- Nav state and the progress rail ---------- */

// The nav gets its glass once the hero has scrolled under it. An observer,
// not a scroll handler, and no layout read at start-up.
const nav = $('#nav');
const hero = $('.hero');
if (nav && hero) {
  new IntersectionObserver((es) => nav.classList.toggle('is-stuck', !es[0]?.isIntersecting), { rootMargin: '-90px 0px 0px 0px' }).observe(hero);
}

const sections = $$('[data-key]');
const railNum = $('[data-rail-num]');
const railName = $('[data-rail-name]');
const navLinks = $$<HTMLAnchorElement>('.links a');
const current = new IntersectionObserver(
  (es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      const n = Number(el.dataset.key) + 1;
      if (railNum) railNum.textContent = String(n).padStart(2, '0');
      if (railName) railName.textContent = el.dataset.name ?? '';
      for (const a of navLinks) {
        if (a.hash === `#${el.id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }
  },
  { rootMargin: '-45% 0px -54% 0px' },
);
sections.forEach((s) => current.observe(s));

/* ---------- Reveals ---------- */

// The observer's first report says what is on screen: that stays as it is,
// everything else is hidden until it scrolls in. Nothing is measured by hand,
// so start-up never forces a layout, and nothing the reader sees ever blinks.
{
  const seen = new WeakSet<Element>();
  const io = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        const first = !seen.has(e.target);
        seen.add(e.target);
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        } else if (first) e.target.setAttribute('data-reveal', '');
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
  );
  for (const el of $$('.stage:not(.hero) .copy > *, .feed-card, .panel, .bento > div, .table-wrap, .cost .h2, .term, .config, .code, .strip, .cta > *')) {
    const idx = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
    el.style.setProperty('--i', String(Math.min(idx, 5)));
    io.observe(el);
  }
  root.classList.add('reveals');
}

/* ---------- The sample feed (section 2) ---------- */

const feedList = $('#feed-list');
const rows = feedList ? $$('li', feedList) : [];
let feedRun = 0;
const showRow = (li: HTMLElement) => {
  li.classList.add('in');
  setTimeout(() => li.classList.add('old'), 1200);
  const w = Number(li.dataset.window);
  if (li.dataset.kind === 'found') {
    emit({ kind: 'found', window: w });
    $('.spot', li)?.classList.add('linked');
  } else if (li.dataset.kind === 'needs-you') emit({ kind: 'needs-you', window: w });
};
function finishFeed() {
  feedRun++;
  rows.forEach((li) => {
    if (!li.classList.contains('in')) showRow(li);
  });
}
async function playFeed() {
  const run = ++feedRun;
  if (!motionOn()) return finishFeed();
  emit({ kind: 'reset', windows: [23, 43] });
  rows.forEach((li) => {
    li.classList.remove('in', 'old');
    $('.spot', li)?.classList.remove('linked');
  });
  feedList?.classList.add('feed-armed');
  for (const li of rows) {
    await wait(900 + Math.random() * 400);
    if (run !== feedRun) return;
    showRow(li);
  }
}
if (feedList && motionOn()) feedList.classList.add('feed-armed');
once($('#feed'), () => void playFeed(), 0.25);
$('[data-replay]')?.addEventListener('click', () => void playFeed());

/* ---------- How it works: the active step follows the scroll ---------- */

const how = $('#how');
const steps = how ? $$('.steps li', how) : [];
const stepList = $('.steps', how ?? document);
addEventListener(
  'scroll',
  () => {
    if (!how || !motionOn() || innerWidth < 900) return;
    const r = how.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
    const i = Math.min(3, Math.floor(p * 4));
    steps.forEach((s, j) => s.classList.toggle('on', j === i));
    stepList?.setAttribute('data-active', String(i));
  },
  { passive: true },
);
steps[0]?.classList.add('on');

/* ---------- Sources marquee: only with six or more names ---------- */

const marquee = $('.marquee');
const [srcA, srcB] = $$('.src-list');
if (marquee && srcA && srcB && srcA.children.length >= 6) {
  srcB.replaceChildren(...[...srcA.children].map((li) => li.cloneNode(true)));
  marquee.classList.add('on');
  new IntersectionObserver((es) => marquee.classList.toggle('off', !es[0]?.isIntersecting)).observe(marquee);
}

/* ---------- Action inbox keyboard demo ---------- */

const demo = $('[data-demo]');
if (demo) {
  const items = $$('.item', demo);
  const live = $('[data-demo-live]', demo);
  let cur = 0;
  const say = (t: string) => {
    if (live) live.textContent = t;
  };
  const select = (i: number) => {
    cur = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((it, j) => {
      it.classList.toggle('cur', j === cur);
      if (j === cur) it.setAttribute('aria-current', 'true');
      else it.removeAttribute('aria-current');
    });
  };
  const titleOf = (it: HTMLElement) => $('.item-title', it)?.textContent ?? '';
  const settle = (state: string, msg: string) => {
    const it = items[cur];
    if (!it) return;
    const s = $('.item-state', it);
    if (s) {
      s.hidden = false;
      s.textContent = state;
    }
    it.classList.add('done');
    say(`${msg}: ${titleOf(it)}. Sample only.`);
    select(cur + 1);
  };
  const act = (k: string) => {
    const it = items[cur];
    if (k === 'j') select(cur + 1);
    else if (k === 'k') select(cur - 1);
    else if (k === 'a') settle('Approved. The reply was sent (sample).', 'Approved');
    else if (k === 'x') settle('Dismissed (sample).', 'Dismissed');
    else if (k === 'e' && it) {
      const d = $('.draft', it);
      if (!d) return;
      d.setAttribute('contenteditable', 'true');
      d.focus();
      getSelection()?.selectAllChildren(d);
      getSelection()?.collapseToEnd();
      say('Editing the draft. Press Escape to stop.');
    } else if (k === 'reset') {
      items.forEach((i) => {
        i.classList.remove('done');
        const s = $('.item-state', i);
        if (s) s.hidden = true;
      });
      select(0);
      say('Demo reset.');
    }
    if (k === 'j' || k === 'k') say(titleOf(items[cur]!));
  };
  demo.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.isContentEditable) {
      if (e.key === 'Escape') {
        t.removeAttribute('contenteditable');
        $<HTMLButtonElement>('[data-key-act="e"]', demo)?.focus();
        say('Draft kept.');
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (!e.ctrlKey && !e.metaKey && !e.altKey && 'jkaex'.includes(k) && k.length === 1) {
      e.preventDefault();
      act(k);
    }
  });
  $$<HTMLButtonElement>('[data-key-act]', demo).forEach((b) => b.addEventListener('click', () => act(b.dataset.keyAct!)));
}

/* ---------- Terminal transcript: typed once, all of it in the DOM from the start ---------- */

const term = $('[data-term]');
const claude = $('#claude');
function finishTerm() {
  term?.classList.remove('term-armed');
}
if (term && motionOn()) term.classList.add('term-armed');
once(term, async () => {
  if (!term || !motionOn()) return finishTerm();
  for (const line of $$('.t-line', term)) {
    const n = Math.max(4, (line.textContent ?? '').trim().length);
    const ms = Math.min(1400, n * 18);
    line.style.setProperty('--n', String(n));
    line.style.setProperty('--t', `${ms}ms`);
    line.classList.add('on');
    if (line.classList.contains('t-tool')) {
      emit({ kind: 'pulse', windows: [23, 43] });
      claude?.classList.add('pulse');
      setTimeout(() => claude?.classList.remove('pulse'), 2600);
    }
    await wait(ms + 260);
  }
}, 0.4);

/* ---------- Copy buttons ---------- */

$$<HTMLButtonElement>('[data-copy]').forEach((b) =>
  b.addEventListener('click', async () => {
    const text = document.getElementById(b.dataset.copy!)?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text.trim());
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Select and copy';
    }
    setTimeout(() => (b.textContent = 'Copy'), 1600);
  }),
);

/* ---------- Contribute: the code block lights line by line and the seventh house is built ---------- */

const code = $('[data-build]');
once(code, async () => {
  if (!code || !motionOn()) return emit({ kind: 'build', progress: 1 });
  emit({ kind: 'build', progress: 1 });
  for (const line of $$('code > span', code)) {
    line.classList.add('hl');
    await wait(80);
    setTimeout(() => line.classList.remove('hl'), 700);
  }
}, 0.4);

/* ---------- Late loading: GSAP, then the stage ---------- */

let motionLoaded = false;
function loadMotion() {
  if (motionLoaded || !motionOn() || stillsQuery) return;
  motionLoaded = true;
  import('./motion').then((m) => m.start()).catch(() => (motionLoaded = false));
}

/** The gate: WebGL2 on real hardware, not a phone, enough memory, Motion on. */
function stageCapable(): boolean {
  if (!motionOn()) return false;
  if (matchMedia('(pointer: coarse)').matches && innerWidth < 900) return false;
  const n = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (n.connection?.saveData || (n.deviceMemory ?? 8) < 4 || (n.hardwareConcurrency ?? 8) < 4) return false;
  const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  if (!gl) return false;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return !/swiftshader|llvmpipe|software|basic render/i.test(name);
}

let stageLoading = false;
function maybeStage() {
  if (stage || stageLoading) return;
  if (!stageCapable()) {
    // The stills load lazily as the reader scrolls.
    root.classList.remove('stage-likely');
    return;
  }
  stageLoading = true;
  root.classList.add('stage-likely');
  import('./stage/index')
    .then((m) => m.start())
    .then((h) => {
      stage = h;
      if (!motionOn()) h.stop();
    })
    .catch(() => root.classList.remove('stage-likely', 'stage-live'))
    .finally(() => (stageLoading = false));
}

const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 600));
const afterLoad = (fn: () => void) => (document.readyState === 'complete' ? idle(fn) : addEventListener('load', () => idle(fn), { once: true }));

if (stillsQuery) {
  // Poster renders (scripts/render-stills.ts): the stage at an exact key, nothing else.
  import('./stage/index').then((m) => m.start({ stills: { key: Number(stillsQuery[1]), portrait: stillsQuery[2] === 'p' } }));
} else {
  afterLoad(() => {
    loadMotion();
    maybeStage();
  });
}
