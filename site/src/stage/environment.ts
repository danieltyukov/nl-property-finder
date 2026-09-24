/*
 * Light for the Street. Instead of a downloaded HDR (Solais ships a 1.39 MB
 * EXR), a tiny scene of emissive panels is rendered into an environment map
 * with PMREM: warm street glow low on the left, cool sky high on the right, a
 * paper fill in front. One map for dusk (light theme) and one for night (dark
 * theme and the night sections); switching themes lerps everything else.
 *
 * Every colour comes from the `--scene-*` tokens in styles/site-tokens.css,
 * read once from the document, so the scene and the CSS share one palette.
 */
import {
  BackSide, BoxGeometry, Color, DirectionalLight, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry,
  PMREMGenerator, Scene, type Texture, type WebGLRenderer,
} from 'three';

export interface Look {
  exposure: number;
  env: number;
  key: Color;
  keyI: number;
  rim: Color;
  rimI: number;
  metal: Color;
  frame: Color;
  lit: Color;
  glow: Color;
  needs: Color;
  grid: Color;
  gridA: number;
  halo: number;
  mote: Color;
  shadowA: number;
  line: Color;
}

/** Reads the scene tokens. `[light, dark]` pairs where the value differs. */
export function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const c = (name: string) => new Color(cs.getPropertyValue(name).trim() || 'gray');
  return {
    envBox: [c('--scene-env-box-l'), c('--scene-env-box-d')] as const,
    oranje: c('--scene-oranje'),
    apricot: c('--scene-apricot'),
    sky: [c('--scene-sky-l'), c('--scene-sky-d')] as const,
    paper: c('--scene-paper'),
    litWarm: c('--scene-lit-l'),
    glass: c('--scene-glass'),
    highlight: c('--scene-highlight'),
    looks: [0, 1].map((d): Look => {
      const s = d ? 'd' : 'l';
      return {
        exposure: d ? 0.95 : 1.05,
        env: d ? 0.9 : 1.0,
        key: c('--scene-apricot'),
        keyI: d ? 3.0 : 3.2,
        rim: c(`--scene-sky-${s}`),
        rimI: d ? 3.0 : 2.2,
        metal: c(`--scene-metal-${s}`),
        frame: c(`--scene-frame-${s}`),
        lit: c(`--scene-lit-${s}`).multiplyScalar(1.25),
        glow: c('--scene-glow'),
        needs: c('--scene-needs').multiplyScalar(1.2),
        grid: c(`--scene-grid-${s}`),
        gridA: d ? 0.22 : 0.55,
        halo: d ? 0.8 : 0.7,
        mote: c(`--scene-mote-${s}`),
        shadowA: d ? 0.5 : 0.3,
        line: c(`--scene-line-${s}`),
      };
    }) as [Look, Look],
  };
}
export type Palette = ReturnType<typeof readPalette>;

/** The procedural dusk (dark = false) or night (dark = true) environment. */
export function envMap(renderer: WebGLRenderer, pal: Palette, dark: boolean): Texture {
  const s = new Scene();
  const d = dark ? 1 : 0;
  s.add(new Mesh(new BoxGeometry(30, 30, 30), new MeshBasicMaterial({ color: pal.envBox[d], side: BackSide })));
  const panel = (col: Color, k: number, pos: [number, number, number], w: number, h: number) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: col.clone().multiplyScalar(k), side: DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 1, 0);
    s.add(m);
  };
  panel(pal.oranje, dark ? 5 : 4, [-9, 0.5, 7], 10, 4);
  panel(pal.apricot, 2.2, [-3, 6, 9], 6, 2);
  panel(pal.sky[d], dark ? 3 : 2.4, [8, 9, -5], 12, 6);
  panel(pal.paper, dark ? 1.2 : 3.0, [10, 4, 10], 14, 10);
  panel(pal.litWarm, dark ? 2.0 : 2.4, [-2, -3, 10], 12, 3);
  // A soft band to the right at eye level: what the fronts mirror from the
  // hero's viewpoint, so they read as metal instead of flat black.
  panel(dark ? pal.sky[1] : pal.paper, dark ? 1.1 : 1.7, [12, 1.4, 1.5], 7, 6);
  panel(pal.apricot, dark ? 1.4 : 1.2, [9, -0.6, 8], 8, 2.5);
  const pmrem = new PMREMGenerator(renderer);
  const tex = pmrem.fromScene(s, 0.03).texture;
  pmrem.dispose();
  s.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as MeshBasicMaterial).dispose();
    }
  });
  return tex;
}

export function makeLights(): { key: DirectionalLight; rim: DirectionalLight } {
  const key = new DirectionalLight();
  key.position.set(-4, 2.2, 6);
  const rim = new DirectionalLight();
  rim.position.set(4, 5, -6);
  return { key, rim };
}

/** `out = a + (b - a) * t` for every field. */
export function mixLook(a: Look, b: Look, t: number, out: Look): Look {
  const n = (x: number, y: number) => x + (y - x) * t;
  out.exposure = n(a.exposure, b.exposure);
  out.env = n(a.env, b.env);
  out.keyI = n(a.keyI, b.keyI);
  out.rimI = n(a.rimI, b.rimI);
  out.gridA = n(a.gridA, b.gridA);
  out.halo = n(a.halo, b.halo);
  out.shadowA = n(a.shadowA, b.shadowA);
  for (const k of ['key', 'rim', 'metal', 'frame', 'lit', 'glow', 'needs', 'grid', 'mote', 'line'] as const) out[k].lerpColors(a[k], b[k], t);
  return out;
}

export function cloneLook(a: Look): Look {
  const o = { ...a };
  for (const k of ['key', 'rim', 'metal', 'frame', 'lit', 'glow', 'needs', 'grid', 'mote', 'line'] as const) o[k] = a[k].clone();
  return o;
}
