/*
 * The camera: ten keyframes, one per section, a Catmull-Rom path through
 * their positions, and a mapping from scroll position to a point on the path.
 *
 * Section i's key is reached when its top reaches the top of the viewport,
 * and the move from key i-1 starts when that top enters at the bottom (the
 * ScrollTrigger convention `start: 'top bottom', end: 'top top'`). Between
 * moves the camera holds. The mapping is computed here from section offsets,
 * not with ScrollTrigger: ScrollTrigger keeps a requestAnimationFrame loop
 * running for as long as the page is open, which would break the "zero frames
 * at rest" rule. The lag that `scrub: 0.8` gives is an exponential follow.
 */
import { CatmullRomCurve3, MathUtils, PerspectiveCamera, Vector3 } from 'three';

type V3 = [number, number, number];
interface Key { pos: V3; target: V3; fov: number; /** Use the field of view as it is (the phone poster). */ raw?: boolean }

/**
 * K0 to K9. Each frames the row beside its section's text, never behind it.
 * K3 and K7 sit under opaque bands; they only keep the path smooth.
 */
export const KEYS: Key[] = [
  { pos: [-6.2, 3.1, 14.2], target: [0.55, 0.95, 0], fov: 22 }, // K0 hero: the row centre right, the h1 on the ember
  { pos: [-3.6, 5.0, 16.5], target: [3.3, 3.0, 0], fov: 24 }, // K1 live feed: the row low left, feed rows point at it
  { pos: [-2.9, 10, 12], target: [-1.7, 0.6, 0.6], fov: 30 }, // K2 how it works: high and oblique, the path on the grid
  { pos: [-3, 5, 10], target: [-1.8, 1.4, 0.5], fov: 26 }, // K3 sources (band)
  { pos: [-2.4, 2.6, 7.5], target: [-1.6, 1.6, 0.4], fov: 24 }, // K4 action inbox: close, blurred behind the panel
  { pos: [-3.8, 3.6, 16], target: [3.4, 3.1, 0], fov: 24 }, // K5 Claude and MCP (band with a night still)
  { pos: [-6.6, 7.2, 19.5], target: [3.0, 2.6, 0], fov: 26 }, // K6 privacy: wide, the box around the row
  { pos: [0.75, 5, 17], target: [1.3, 2.6, -0.6], fov: 24 }, // K7 cost (band)
  { pos: [7.5, 3.6, 16], target: [-0.6, 2.2, -1.2], fov: 22 }, // K8 contribute: from the right, the seventh house
  { pos: [-6.8, 2.6, 15.5], target: [-1.4, 1.3, 0], fov: 22 }, // K9 footer: night, the row right of the text
];

/** Phones get a portrait poster of the hero; this is its camera (stills only). */
export const PORTRAIT_KEY: Key = { pos: [-8.3, 5.0, 20.1], target: [0.2, -1.5, 0.4], fov: 31, raw: true };

const smooth = (f: number) => f * f * (3 - 2 * f);
const v = (a: V3) => new Vector3(...a);

export interface Section { el: HTMLElement; key: number }

export class CameraRig {
  readonly camera: PerspectiveCamera;
  private readonly curve = new CatmullRomCurve3(KEYS.map((k) => v(k.pos)), false, 'catmullrom', 0.5);
  private readonly targets = KEYS.map((k) => v(k.target));
  /** Current and wanted position on the path, in key units (0 to 9). */
  t = 0;
  to = 0;
  private table: [number, number][] = [[0, 0]];
  private yaw = 0;
  private pitch = 0;
  private yawTo = 0;
  private pitchTo = 0;
  private focusW = 0;
  private focusTo = 0;
  private readonly fTarget = new Vector3();
  private readonly pos = new Vector3();
  private readonly target = new Vector3();
  private readonly tmp = new Vector3();
  private readonly right = new Vector3();
  /** Set for poster renders: an exact key, no lag, no parallax. */
  fixed: Key | null = null;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(22, aspect, 0.1, 100);
  }

  /** Rebuild the scroll-to-key table from the sections' offsets. Call on load and resize. */
  measure(sections: Section[], vh: number, maxScroll: number): void {
    const s = sections.slice().sort((a, b) => a.key - b.key);
    const top = (el: HTMLElement) => el.getBoundingClientRect().top + scrollY;
    const table: [number, number][] = [[0, s[0]?.key ?? 0]];
    for (let i = 1; i < s.length; i++) {
      const prev = s[i - 1]!;
      const cur = s[i]!;
      const last = table[table.length - 1]![0];
      const start = Math.min(maxScroll, Math.max(top(cur.el) - vh, top(prev.el), last));
      const end = Math.min(maxScroll, Math.max(top(cur.el), start + 1));
      table.push([start, prev.key], [end, cur.key]);
    }
    this.table = table;
  }

  /** Where the path should be for a scroll position. */
  fromScroll(y: number): number {
    const tb = this.table;
    if (y <= tb[0]![0]) return tb[0]![1];
    for (let i = 1; i < tb.length; i++) {
      const [y1, k1] = tb[i]!;
      if (y <= y1) {
        const [y0, k0] = tb[i - 1]!;
        return y1 === y0 ? k1 : k0 + ((y - y0) / (y1 - y0)) * (k1 - k0);
      }
    }
    return tb[tb.length - 1]![1];
  }

  /** Pointer position in -1..1; the camera turns at most 3 degrees across and 1.5 up. */
  parallax(nx: number, ny: number): void {
    this.yawTo = nx * MathUtils.degToRad(3);
    this.pitchTo = ny * MathUtils.degToRad(1.5);
  }

  /**
   * Frame a window (a hotspot has focus or hover), or return to the scroll
   * pose. The camera stays where it is, turns toward the window and narrows
   * its view a fifth, so the text beside the scene stays where it was.
   */
  focus(win: Vector3 | null): void {
    if (!win) {
      this.focusTo = 0;
      return;
    }
    this.fTarget.copy(win);
    this.focusTo = 1;
  }

  /** Advance the follow. `instant` jumps (motion off, poster renders). Returns true while moving. */
  update(dt: number, instant = false): boolean {
    const k = instant ? 1 : 1 - Math.exp(-dt * 4.2);
    const kp = instant ? 1 : 1 - Math.exp(-dt * 5);
    const kf = instant ? 1 : Math.min(1, dt / 0.6);
    this.t += (this.to - this.t) * k;
    this.yaw += (this.yawTo - this.yaw) * kp;
    this.pitch += (this.pitchTo - this.pitch) * kp;
    this.focusW = this.focusTo > this.focusW ? Math.min(this.focusTo, this.focusW + kf) : Math.max(this.focusTo, this.focusW - kf);
    const moving =
      Math.abs(this.to - this.t) > 1e-4 || Math.abs(this.yawTo - this.yaw) > 1e-5 || Math.abs(this.pitchTo - this.pitch) > 1e-5 || this.focusW !== this.focusTo;
    if (!moving) this.t = this.to;
    this.apply();
    return moving;
  }

  /** Write the pose for the current path position into the camera. */
  apply(): void {
    const cam = this.camera;
    let fov: number;
    if (this.fixed) {
      this.pos.set(...this.fixed.pos);
      this.target.set(...this.fixed.target);
      fov = this.fixed.fov;
    } else {
      const t = MathUtils.clamp(this.t, 0, KEYS.length - 1);
      const i = Math.min(Math.floor(t), KEYS.length - 2);
      const f = smooth(t - i);
      this.curve.getPoint((i + f) / (KEYS.length - 1), this.pos);
      this.target.lerpVectors(this.targets[i]!, this.targets[i + 1]!, f);
      fov = MathUtils.lerp(KEYS[i]!.fov, KEYS[i + 1]!.fov, f);
      if (this.focusW > 0) {
        const w = smooth(this.focusW);
        this.target.lerp(this.fTarget, w);
        fov = MathUtils.lerp(fov, fov * 0.8, w);
      }
      // Cursor parallax: orbit the target a little, never move the Street.
      if (this.yaw || this.pitch) {
        const off = this.tmp.subVectors(this.pos, this.target);
        off.applyAxisAngle(this.right.set(0, 1, 0), this.yaw);
        this.right.crossVectors(off, cam.up).normalize();
        off.applyAxisAngle(this.right, this.pitch);
        this.pos.addVectors(this.target, off);
      }
    }
    // The keys are composed at 16:10. The view keeps that width at any other
    // shape (taller windows see more above and below, not less at the sides),
    // exactly as the posters are scaled to the page width.
    if (!this.fixed?.raw) fov = MathUtils.radToDeg(2 * Math.atan((Math.tan(MathUtils.degToRad(fov) / 2) * 1.6) / Math.max(cam.aspect, 1)));
    cam.position.copy(this.pos);
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(this.target);
    cam.updateMatrixWorld();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
