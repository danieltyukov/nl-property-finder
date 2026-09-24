/*
 * Text motion, loaded with import() after `load` and an idle moment, and only
 * with Motion on: GSAP core, SplitText and ScrambleText.
 *
 * ScrollTrigger is deliberately not used. Once registered it keeps a
 * requestAnimationFrame loop running for the life of the page (gsap 3.15,
 * ScrollTrigger.js `_rafBugFix`), which would break the rule of zero frames at
 * rest. Triggers here are IntersectionObservers that fire once; GSAP's own
 * ticker goes to sleep two seconds after the last tween ends.
 *
 * - h2: lines rise out of a mask once, when the heading comes into view.
 *   SplitText's `aria: 'auto'` labels the heading and hides the pieces.
 * - Short mono labels scramble in once. Only the aria-hidden copies are
 *   touched; the real text sits beside them for assistive technology.
 * - The pipeline strip counts up once. The primary button pulls a few pixels
 *   toward a fine pointer.
 */
import { gsap } from 'gsap';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { SplitText } from 'gsap/SplitText';

const root = document.documentElement;
const on = () => !root.classList.contains('motion-off');

/** Runs `fn` once per element when it comes into view, saying whether Motion is on at that moment. */
function whenSeen(els: Element[], fn: (el: HTMLElement, moving: boolean) => void, threshold = 0.2): void {
  const io = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        fn(e.target as HTMLElement, on());
      }
    },
    { threshold },
  );
  els.forEach((el) => io.observe(el));
}

const inView = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.top < innerHeight && r.bottom > 0;
};

export function start(): void {
  gsap.registerPlugin(SplitText, ScrambleTextPlugin);
  const ease = 'expo.out';

  // Headings below the fold: prepared hidden, revealed once in view. Headings
  // already on screen are left as they are, so nothing visible ever blinks.
  const heads = [...document.querySelectorAll<HTMLElement>('.h2')].filter((h) => !inView(h));
  for (const h of heads) {
    const split = SplitText.create(h, { type: 'lines', mask: 'lines', aria: 'auto', linesClass: 'ln' });
    gsap.set(split.lines, { yPercent: 105 });
    // Motion may have been turned off since: then the lines are simply put back.
    whenSeen([h], (_, moving) => {
      if (moving) gsap.to(split.lines, { yPercent: 0, duration: 0.8, ease, stagger: 0.09, onComplete: () => split.revert() });
      else split.revert();
    });
  }

  whenSeen(
    [...document.querySelectorAll('[data-scramble]')],
    (el, moving) => {
      if (!moving) return;
      const text = el.textContent ?? '';
      gsap.to(el, { duration: 0.8, ease: 'none', scrambleText: { text, chars: '01_/', revealDelay: 0.2, speed: 0.6 } });
    },
    0.5,
  );

  whenSeen([...document.querySelectorAll('[data-count]')], (el, moving) => {
    if (!moving) return;
    const n = Number(el.dataset.count);
    const o = { v: 0 };
    gsap.to(o, { v: n, duration: 0.8, ease: 'power2.out', onUpdate: () => (el.textContent = String(Math.round(o.v))) });
  });

  if (matchMedia('(pointer: fine)').matches) {
    for (const b of document.querySelectorAll<HTMLElement>('.magnetic')) {
      const x = gsap.quickTo(b, 'x', { duration: 0.4, ease });
      const y = gsap.quickTo(b, 'y', { duration: 0.4, ease });
      b.addEventListener('pointermove', (e) => {
        if (!on()) return;
        const r = b.getBoundingClientRect();
        x(((e.clientX - r.left) / r.width - 0.5) * 8);
        y(((e.clientY - r.top) / r.height - 0.5) * 8);
      });
      b.addEventListener('pointerleave', () => {
        x(0);
        y(0);
      });
    }
  }
}
