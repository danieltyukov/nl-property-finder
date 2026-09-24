/*
 * The Street: six extruded canal-house gables left to right (trapgevel,
 * halsgevel, klokgevel, tuitgevel, lijstgevel, a wide trapgevel), each with
 * white window frames and panes that light up as listings are found, plus a
 * seventh house that is built in the Contribute section.
 *
 * Units are roughly one house width. The row stands on the grid at y = 0,
 * turned 0.5 rad so the extrusion shows. Windows are instanced: one mesh of
 * frames and one of panes for all sixty, so lighting a window is a colour
 * change on one instance, not a new draw call.
 */
import {
  BufferAttribute, BufferGeometry, BoxGeometry, Color, ExtrudeGeometry, Group, InstancedMesh, Mesh,
  Object3D, PlaneGeometry, Points, Shape, Vector3, type Material, type ShaderMaterial,
} from 'three';

export interface Win { x: number; y: number; w: number; h: number; door?: boolean; house: number }

interface Profile { w: number; eave: number; shape: Shape }

function poly(pts: number[]): Shape {
  const s = new Shape();
  s.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i]!, pts[i + 1]!);
  s.closePath();
  return s;
}

/** Half an outline from bottom right to the top centre, mirrored to the left. */
function mirror(half: [number, number][]): Shape {
  const right = half.flat();
  const left = half.slice().reverse().map(([x, y]) => [-x, y]).flat();
  return poly([...right, ...left]);
}

function bell(w: number, eave: number): Shape {
  const s = new Shape();
  const h = w / 2;
  s.moveTo(-h, 0);
  s.lineTo(h, 0);
  s.lineTo(h, eave);
  s.quadraticCurveTo(0.26, eave + 0.1, 0.22, eave + 0.5);
  s.absarc(0, eave + 0.5, 0.22, 0, Math.PI, false);
  s.quadraticCurveTo(-0.26, eave + 0.1, -h, eave);
  s.closePath();
  return s;
}

const PROFILES: Profile[] = [
  { w: 1.0, eave: 1.9, shape: mirror([[0.5, 0], [0.5, 1.9], [0.38, 1.9], [0.38, 2.12], [0.26, 2.12], [0.26, 2.34], [0.14, 2.34], [0.14, 2.56], [0, 2.56]]) },
  { w: 0.9, eave: 1.98, shape: mirror([[0.45, 0], [0.45, 1.98], [0.2, 2.18], [0.2, 2.58], [0.12, 2.64], [0, 2.74]]) },
  { w: 0.95, eave: 1.8, shape: bell(0.95, 1.8) },
  { w: 0.85, eave: 2.02, shape: mirror([[0.425, 0], [0.425, 2.02], [0.1, 2.5], [0.1, 2.64], [0, 2.64]]) },
  { w: 1.1, eave: 2.06, shape: mirror([[0.55, 0], [0.55, 2.06], [0.6, 2.09], [0.6, 2.18], [0, 2.18]]) },
  { w: 1.15, eave: 1.72, shape: mirror([[0.575, 0], [0.575, 1.72], [0.46, 1.72], [0.46, 1.9], [0.34, 1.9], [0.34, 2.08], [0.22, 2.08], [0.22, 2.26], [0.1, 2.26], [0.1, 2.44], [0, 2.44]]) },
];
/** The seventh house: a neck gable, built from the grid in section 9. */
const SEVENTH: Profile = { w: 0.95, eave: 2.1, shape: mirror([[0.475, 0], [0.475, 2.1], [0.22, 2.3], [0.22, 2.66], [0.13, 2.72], [0, 2.82]]) };

const DEPTH = 0.42;
const X0 = -3.05;
const GAP = 0.02;

/** Windows of one house, in street coordinates. Order: floors bottom to top, then door, ground window, gable window. */
function windowsFor(p: Profile, cx: number, house: number): Win[] {
  const out: Win[] = [];
  const cols = p.w > 1.0 ? 3 : 2;
  // Three floors spaced from the ground floor to just under the eave, so a
  // low house gets tighter floors instead of windows that overlap.
  const d = (p.eave - 0.36 - 0.8) / 2;
  for (const fy of [0.8, 0.8 + d, 0.8 + 2 * d]) {
    for (let c = 0; c < cols; c++) out.push({ x: cx + (c - (cols - 1) / 2) * (p.w / (cols + 0.25)), y: fy, w: 0.15, h: 0.2, house });
  }
  out.push({ x: cx - p.w * 0.22, y: 0.36, w: 0.15, h: 0.42, door: true, house });
  out.push({ x: cx + p.w * 0.18, y: 0.42, w: 0.24, h: 0.3, house });
  out.push({ x: cx, y: p.eave + 0.25, w: 0.12, h: 0.18, house });
  return out;
}

/** A vertical ambient-occlusion gradient as vertex colours: dark at street level. */
function withOcclusion(geo: BufferGeometry, top: number): BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / top;
    const k = 0.5 + 0.5 * Math.min(1, Math.max(0, y * 1.35));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  return geo;
}

function extrude(p: Profile): ExtrudeGeometry {
  const geo = new ExtrudeGeometry(p.shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 5, curveSegments: 20 });
  geo.translate(0, 0, -DEPTH);
  withOcclusion(geo, 2.8);
  return geo;
}

export interface WindowSet {
  frames: InstancedMesh;
  panes: InstancedMesh;
  halos: Points;
}

function windowSet(wins: Win[], frameMat: Material, paneMat: Material, haloMat: ShaderMaterial): WindowSet {
  const frames = new InstancedMesh(new BoxGeometry(1, 1, 0.03), frameMat, wins.length);
  const panes = new InstancedMesh(new PlaneGeometry(1, 1), paneMat, wins.length);
  const o = new Object3D();
  wins.forEach((w, i) => {
    o.position.set(w.x, w.y, 0.05);
    o.scale.set(w.w + 0.05, w.h + 0.05, 1);
    o.updateMatrix();
    frames.setMatrixAt(i, o.matrix);
    o.position.z = 0.068;
    o.scale.set(w.w, w.h, 1);
    o.updateMatrix();
    panes.setMatrixAt(i, o.matrix);
    panes.setColorAt(i, new Color(0, 0, 0));
  });
  const hp = new Float32Array(wins.length * 3);
  wins.forEach((w, i) => hp.set([w.x, w.y, 0.09], i * 3));
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(hp, 3));
  geo.setAttribute('aLit', new BufferAttribute(new Float32Array(wins.length), 1));
  geo.setAttribute('aPulse', new BufferAttribute(new Float32Array(wins.length).fill(1), 1));
  geo.setAttribute('aCol', new BufferAttribute(new Float32Array(wins.length * 3), 3));
  const halos = new Points(geo, haloMat);
  halos.frustumCulled = false;
  return { frames, panes, halos };
}

export interface StreetOptions {
  facade: Material;
  frame: Material;
  pane: Material;
  halo: ShaderMaterial;
  highlight: ShaderMaterial;
  shadow: Material;
}

/** Light state of one window: the value ramps toward the target. */
interface Light { v: number; to: number; kind: 0 | 1; blink: number; pulse: number }

export class Street {
  readonly group = new Group();
  readonly windows: Win[] = [];
  readonly seventh = new Group();
  readonly seventhWindows: Win[] = [];
  private readonly sets: WindowSet[];
  private readonly lights: Light[][];
  private readonly highlight: Mesh;
  private readonly lit = new Color();
  private readonly needs = new Color();
  private readonly glow = new Color();
  private build = 1;
  private readonly tmp = new Color();

  constructor(o: StreetOptions) {
    let x = X0;
    PROFILES.forEach((p, i) => {
      const m = new Mesh(extrude(p), o.facade);
      const cx = x + p.w / 2;
      m.position.x = cx;
      this.group.add(m);
      this.windows.push(...windowsFor(p, cx, i));
      x += p.w + GAP;
    });
    // The seventh house stands after the sixth, in its own group so it can
    // rise and extrude without touching the others.
    const sx = x + SEVENTH.w / 2 + 0.02;
    const sm = new Mesh(extrude(SEVENTH), o.facade);
    this.seventh.position.x = sx;
    this.seventh.add(sm);
    this.seventhWindows.push(...windowsFor(SEVENTH, 0, 6));
    this.group.add(this.seventh);

    const main = windowSet(this.windows, o.frame, o.pane, o.halo);
    const extra = windowSet(this.seventhWindows, o.frame, o.pane, o.halo);
    this.group.add(main.frames, main.panes, main.halos);
    this.seventh.add(extra.frames, extra.panes, extra.halos);
    this.sets = [main, extra];
    this.lights = [this.windows, this.seventhWindows].map((ws) => ws.map(() => ({ v: 0, to: 0, kind: 0 as const, blink: 0, pulse: 0 })));

    const shadow = new Mesh(new PlaneGeometry(8.6, 1.9), o.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0.35, 0.002, 0.1);
    this.group.add(shadow);

    this.highlight = new Mesh(new PlaneGeometry(1, 1), o.highlight);
    this.highlight.visible = false;
    this.group.add(this.highlight);

    this.group.rotation.y = 0.5;
    this.group.position.set(0.9, 0, 0.4);
    this.setBuild(1);
  }

  setColors(lit: Color, needs: Color, glow: Color): void {
    this.lit.copy(lit);
    this.needs.copy(needs);
    this.glow.copy(glow);
    for (let s = 0; s < this.sets.length; s++) this.paint(s);
  }

  /** Light (or darken) window i. `instant` skips the 400 ms ramp. */
  setLit(i: number, on: boolean, instant = false, set = 0): void {
    const l = this.lights[set]?.[i];
    const w = (set ? this.seventhWindows : this.windows)[i];
    if (!l || !w || w.door) return;
    l.to = on ? 1 : 0;
    l.kind = 0;
    if (instant) l.v = l.to;
  }

  setNeeds(i: number, instant = false): void {
    const l = this.lights[0]?.[i];
    if (!l) return;
    l.to = 1;
    l.kind = 1;
    l.blink = instant ? 0 : 2;
    if (instant) l.v = 1;
  }

  pulse(i: number): void {
    const l = this.lights[0]?.[i];
    if (l) l.pulse = 1;
  }

  isLit(i: number): boolean {
    return (this.lights[0]?.[i]?.to ?? 0) > 0.5;
  }

  /** Seventh house: 0 is flat under the grid, 1 is built. */
  setBuild(p: number): void {
    this.build = p;
    const e = p <= 0 ? 0 : p;
    this.seventh.scale.set(1, Math.max(0.0001, Math.min(1, e * 1.25)), Math.max(0.0001, Math.min(1, (e - 0.2) / 0.8)));
    this.seventh.visible = p > 0.001;
  }

  get built(): number {
    return this.build;
  }

  /** World position of window i (street set 0) or of a seventh-house window (set 1). */
  worldPos(i: number, out: Vector3, set = 0): Vector3 {
    const w = (set ? this.seventhWindows : this.windows)[i];
    if (!w) return out.set(0, 0, 0);
    out.set(w.x, w.y, 0.09);
    return out.applyMatrix4((set ? this.seventh : this.group).matrixWorld);
  }

  /** Outward normal of the facades in world space. */
  normal(out: Vector3): Vector3 {
    return out.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
  }

  showHighlight(i: number | null): void {
    const w = i === null ? undefined : this.windows[i];
    this.highlight.visible = Boolean(w);
    if (!w) return;
    this.highlight.position.set(w.x, w.y, 0.09);
    this.highlight.scale.set(w.w + 0.16, w.h + 0.16, 1);
  }

  /** Advance light ramps. Returns true while anything is still changing. */
  update(dt: number): boolean {
    let busy = false;
    for (let s = 0; s < this.lights.length; s++) {
      let dirty = false;
      for (const l of this.lights[s]!) {
        if (l.v !== l.to) {
          const step = dt / 0.4;
          l.v = l.to > l.v ? Math.min(l.to, l.v + step) : Math.max(l.to, l.v - step);
          dirty = true;
        }
        if (l.blink > 0) {
          l.blink = Math.max(0, l.blink - dt * 2.5);
          dirty = true;
        }
        if (l.pulse > 0) {
          l.pulse = Math.max(0, l.pulse - dt / 1.2);
          dirty = true;
        }
      }
      if (dirty) {
        this.paint(s);
        busy = true;
      }
    }
    return busy;
  }

  private paint(s: number): void {
    const set = this.sets[s]!;
    const lights = this.lights[s]!;
    const lit = set.halos.geometry.getAttribute('aLit') as BufferAttribute;
    const pulse = set.halos.geometry.getAttribute('aPulse') as BufferAttribute;
    const col = set.halos.geometry.getAttribute('aCol') as BufferAttribute;
    lights.forEach((l, i) => {
      // A blinking needs-you window drops to dark twice before it settles.
      const blinkDark = l.blink > 0 && Math.sin(l.blink * Math.PI * 2) > 0;
      const v = blinkDark ? 0.08 : l.v;
      this.tmp.copy(l.kind ? this.needs : this.lit).multiplyScalar(v);
      set.panes.setColorAt(i, this.tmp);
      lit.setX(i, v);
      pulse.setX(i, 1 + 0.6 * l.pulse * l.pulse);
      const g = l.kind ? this.needs : this.glow;
      col.setXYZ(i, g.r, g.g, g.b);
    });
    if (set.panes.instanceColor) set.panes.instanceColor.needsUpdate = true;
    lit.needsUpdate = pulse.needsUpdate = col.needsUpdate = true;
  }
}
