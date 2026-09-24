/*
 * The DOM layer over the Street: diamonds on windows, leader lines from a
 * window to its callout card, and small data labels. None of it is WebGL.
 *
 * The same elements serve both paths. Without the live scene they sit at the
 * positions measured on the posters (stills.json, written into the HTML as
 * --ax and --ay). With it, each moving frame projects their 3D anchors and
 * moves them with a transform; the cards themselves never move, only the
 * line's window end does, so the text stays still under the reader's eye.
 *
 * Anchored elements declare their 3D point in the HTML: `data-window="32"` (a
 * window of the Street) or `data-point="x,y,z"` (a point in street space).
 * Positions are local to the section's `.anchors` layer.
 */
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import type { Street } from './street';

interface Pin {
  el: HTMLElement;
  box: HTMLElement;
  win: number;
  point: Vector3 | null;
  key: number;
  /** How far from its key (in path units) the pin stays visible. */
  reach: number;
}

interface Link {
  card: HTMLElement;
  pin: Pin;
  leader: HTMLElement;
  win: number;
  key: number;
  /** Feed rows show their line only while they are linked, hovered or focused. */
  transient: boolean;
}

const keyOf = (el: Element) => Number(el.closest<HTMLElement>('[data-key]')?.dataset.key ?? 0);

function el(tag: string, cls: string, parent: HTMLElement): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.setAttribute('aria-hidden', 'true');
  e.style.left = e.style.top = '0';
  parent.append(e);
  return e;
}

/**
 * Where the CSS placed an element from its poster anchor (--ax, --ay), in
 * pixels inside its box. The live scene moves elements with a transform
 * relative to that spot instead of resetting left and top, because a change
 * of layout position would count as a layout shift and a transform does not.
 */
function base(node: HTMLElement, box: DOMRect): [number, number] {
  const ax = Number.parseFloat(node.style.getPropertyValue('--ax'));
  const ay = Number.parseFloat(node.style.getPropertyValue('--ay'));
  if (Number.isNaN(ax) || Number.isNaN(ay)) return [0, 0];
  const s = box.width / 1440;
  return [ax * s, box.height / 2 + (ay - 450) * s];
}

export class Overlay {
  private readonly pins: Pin[] = [];
  private readonly links: Link[] = [];
  private readonly v = new Vector3();
  private readonly boxes = new Map<HTMLElement, DOMRect>();

  constructor(private readonly street: Street) {
    const pinFor = (node: HTMLElement): Pin | null => {
      const box = node.closest<HTMLElement>('.anchors');
      if (!box) return null;
      const p = node.dataset.point?.split(',').map(Number);
      const pin: Pin = {
        el: node,
        box,
        win: Number(node.dataset.window ?? -1),
        point: p && p.length === 3 ? new Vector3(p[0], p[1], p[2]) : null,
        key: keyOf(node),
        reach: Number(node.dataset.reach ?? 0.5),
      };
      this.pins.push(pin);
      return pin;
    };
    // The Claude band's glows belong to its still image, not to the live scene.
    document.querySelectorAll<HTMLElement>('.anchors .pin:not(.glow)').forEach(pinFor);

    // Cards with a line to a window. The hero's diamond and line exist in the
    // HTML (for the no-JS layout); feed rows get theirs created here.
    document.querySelectorAll<HTMLElement>('[data-callout]').forEach((card) => {
      const section = card.closest<HTMLElement>('[data-key]');
      const box = section?.querySelector<HTMLElement>('.anchors');
      if (!box) return;
      const win = Number(card.dataset.window);
      let diamond = box.querySelector<HTMLElement>(`.diamond[data-for="${card.id}"]`);
      let leader = box.querySelector<HTMLElement>(`.leader[data-for="${card.id}"]`);
      const transient = card.dataset.callout === 'row';
      if (!diamond) {
        diamond = el('span', 'pin diamond', box);
        diamond.dataset.window = String(win);
      }
      leader ??= el('span', 'leader', box);
      const pin = this.pins.find((p) => p.el === diamond) ?? pinFor(diamond);
      if (pin) this.links.push({ card, pin, leader, win, key: keyOf(card), transient });
    });
  }

  /** Windows that have a callout card, for hotspot focus. */
  get cards(): { card: HTMLElement; win: number }[] {
    return this.links.map((l) => ({ card: l.card, win: l.win }));
  }

  private rect(box: HTMLElement): DOMRect {
    let r = this.boxes.get(box);
    if (!r) {
      r = box.getBoundingClientRect();
      this.boxes.set(box, r);
    }
    return r;
  }

  /** Viewport position of a pin's 3D point, or null when behind the camera. */
  private project(pin: Pin, camera: PerspectiveCamera, vw: number, vh: number): [number, number] | null {
    if (pin.win >= 0) this.street.worldPos(pin.win, this.v);
    else if (pin.point) this.v.copy(pin.point).applyMatrix4(this.street.group.matrixWorld);
    else return null;
    this.v.project(camera);
    if (this.v.z > 1) return null;
    return [((this.v.x + 1) / 2) * vw, ((1 - this.v.y) / 2) * vh];
  }

  /** Reposition everything for the current camera. `t` is the camera's path position. */
  update(camera: PerspectiveCamera, t: number, vw: number, vh: number): void {
    this.boxes.clear();
    for (const pin of this.pins) {
      const vis = MathUtils.clamp(1 - (Math.abs(t - pin.key) - pin.reach * 0.5) / (pin.reach * 0.5), 0, 1);
      pin.el.style.opacity = vis > 0 ? String(vis) : '0';
      if (vis <= 0) continue;
      const p = this.project(pin, camera, vw, vh);
      if (!p) {
        pin.el.style.opacity = '0';
        continue;
      }
      const r = this.rect(pin.box);
      const [bx, by] = base(pin.el, r);
      pin.el.style.transform = `translate3d(${(p[0] - r.left - bx).toFixed(1)}px,${(p[1] - r.top - by).toFixed(1)}px,0)`;
    }
    for (const l of this.links) {
      const card = l.card;
      const on = !l.transient || card.classList.contains('linked') || card.matches(':hover,:focus-visible');
      const near = MathUtils.clamp(1 - (Math.abs(t - l.key) - 0.25) / 0.25, 0, 1);
      const vis = on ? near : 0;
      l.leader.style.opacity = String(vis);
      if (l.transient) l.pin.el.style.opacity = String(vis);
      if (vis <= 0) continue;
      const p = this.project(l.pin, camera, vw, vh);
      if (!p) continue;
      const r = this.rect(l.pin.box);
      const c = card.getBoundingClientRect();
      // A feed row's line ends at the edge of its card, level with the row.
      const edge = card.closest('[data-edge]')?.getBoundingClientRect() ?? c;
      const x0 = p[0] - r.left;
      const y0 = p[1] - r.top;
      const x1 = (p[0] < edge.left ? edge.left - 6 : edge.right + 6) - r.left;
      const y1 = c.top + Math.min(14, c.height / 2) - r.top;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const [bx, by] = base(l.leader, r);
      l.leader.style.transform = `translate3d(${(x0 - bx).toFixed(1)}px,${(y0 - by).toFixed(1)}px,0) rotate(${ang.toFixed(4)}rad)`;
      l.leader.style.width = `${len.toFixed(1)}px`;
    }
  }

  /** Viewport positions of the anchors of one key, for stills.json. */
  measure(camera: PerspectiveCamera, key: number, vw: number, vh: number): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    document.querySelectorAll<HTMLElement>(`[data-anchor^="k${key}."]`).forEach((node) => {
      const pin: Pin = {
        el: node,
        box: node,
        win: Number(node.dataset.window ?? -1),
        point: node.dataset.point ? new Vector3(...(node.dataset.point.split(',').map(Number) as [number, number, number])) : null,
        key,
        reach: 1,
      };
      const p = this.project(pin, camera, vw, vh);
      if (p && node.dataset.anchor) out[node.dataset.anchor] = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    });
    return out;
  }
}
