/*
 * The stage: the Street rendered live with three.js over the poster.
 *
 * main.ts imports this module with import() only after the page has painted
 * and only when the gate passes (WebGL2 on real hardware, not a phone, enough
 * memory, Motion on). Everything the scene shows is also in the HTML as text
 * and in the posters, so nothing is lost when this never loads.
 *
 * One render loop, on demand: `setAnimationLoop(tick)` runs only while
 * something moves (the camera following the scroll, a window lighting, a
 * theme change, the pointer in the last two seconds) and is removed as soon
 * as everything settles. It also stops when no stage section is on screen,
 * when the tab is hidden and when Motion is turned off. At rest the page
 * makes no animation-frame callbacks at all.
 */
import {
  ACESFilmicToneMapping, BufferAttribute, BufferGeometry, CatmullRomCurve3, LineSegments, Mesh, PlaneGeometry,
  Points, Scene, SRGBColorSpace, TubeGeometry, Vector3, WebGLRenderer, type Texture,
} from 'three';
import { CameraRig, KEYS, PORTRAIT_KEY, type Section } from './camera';
import { cloneLook, envMap, makeLights, mixLook, readPalette } from './environment';
import { feedState, on } from './events';
import {
  facadeMaterial, facadeTexture, frameMaterial, gridMaterial, haloMaterial, highlightMaterial, lineMaterial, moteMaterial,
  paneMaterial, particleMaterial, pathMaterial, seeded, shadowMaterial,
} from './materials';
import { Overlay } from './overlay';
import { Street } from './street';

/** Windows lit on the hero poster: the listings of the sample run. Doors never light. */
const BASE = [2, 5, 9, 12, 20, 26, 31, 32, 34, 38, 42, 47, 50, 56];
/** The hero callout's window, and the window the Action inbox frames. */
const HERO = 32;
const NEEDS = 23;
/** The feed's state at its last row, used for the posters of sections 2 to 8. */
const FEED_LIT = [43];
const FEED_NEEDS = [23];
/** Seventh-house windows that light as the code block's lines highlight. */
const SEVENTH_LIT = [1, 2, 4, 5, 7];

export interface StageOptions {
  /** Poster render: an exact key, both themes chosen by the page, no motion. */
  stills?: { key: number; portrait?: boolean };
}

export interface StageHandle {
  stop(): void;
  resume(): void;
}

const root = document.documentElement;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/**
 * Scroll through "How it works" (0 to 1) to the share of the path drawn. Each
 * of the four steps gets a quarter of the scroll; the path's parts are not
 * equally long (sites to house, into the window, back out).
 */
const STEP_ENDS = [0.03, 0.44, 0.53, 0.66, 1];
const pathAt = (p: number) => {
  const s = Math.min(3, Math.floor(p * 4));
  return STEP_ENDS[s]! + (STEP_ENDS[s + 1]! - STEP_ENDS[s]!) * Math.min(1, (p * 4 - s) * 1.25);
};
/**
 * Hand the main thread back between start-up steps, so building the scene is a
 * series of short tasks instead of one long one that would delay input.
 */
const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const isDark = () => {
  const t = root.dataset.theme;
  return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
};

export async function start(opts: StageOptions = {}): Promise<StageHandle> {
  const stills = opts.stills;
  const layer = document.querySelector<HTMLElement>('.stage-layer')!;
  const canvas = layer.querySelector('canvas')!;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: Boolean(stills) });
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  const cap = /intel|mali/i.test(gpu) ? 1.25 : 1.5;
  let dpr = stills ? devicePixelRatio : Math.min(devicePixelRatio, cap);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  await yieldTask();

  const pal = readPalette();
  const [dusk, night] = pal.looks;
  const look = cloneLook(dusk);
  const scene = new Scene();
  const dark0 = isDark();
  const envs = [] as unknown as [Texture, Texture];
  envs[dark0 ? 1 : 0] = envMap(renderer, pal, dark0);
  await yieldTask();
  envs[dark0 ? 0 : 1] = envMap(renderer, pal, !dark0);
  await yieldTask();

  // Materials and the Street.
  const facade = facadeMaterial(facadeTexture());
  const frame = frameMaterial();
  const pane = paneMaterial();
  pane.color.copy(pal.glass);
  const halo = haloMaterial(dpr);
  const highlight = highlightMaterial();
  highlight.uniforms.uColor!.value.copy(pal.highlight);
  const shadow = shadowMaterial();
  const street = new Street({ facade, frame, pane, halo, highlight, shadow });
  scene.add(street.group);
  await yieldTask();
  const { key, rim } = makeLights();
  scene.add(key, rim);

  const grid = new Mesh(new PlaneGeometry(40, 40), gridMaterial());
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -0.001;
  scene.add(grid);

  // Ambient motes, seeded so the posters and the live scene agree.
  const particles = (() => {
    const n = 260;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const rnd = seeded(11);
    for (let i = 0; i < n; i++) {
      pos.set([(rnd() - 0.5) * 12, rnd() * 4.2, (rnd() - 0.3) * 7], i * 3);
      size[i] = 1 + rnd() * rnd() * 7;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('size', new BufferAttribute(size, 1));
    const p = new Points(g, particleMaterial(dpr));
    p.frustumCulled = false;
    return p;
  })();
  scene.add(particles);

  // Listing motes: one point per found event, flying from the water line in front of the row into its window.
  const MOTES = 4;
  const moteGeo = new BufferGeometry();
  moteGeo.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
  moteGeo.setAttribute('aA', new BufferAttribute(new Float32Array(MOTES), 1));
  const moteMat = moteMaterial(dpr);
  const motes = new Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);
  const flights: { win: number; t: number; a: Vector3; c: Vector3; b: Vector3; slot: number }[] = [];

  // "How it works": a glowing path from the sites on the left, to the house, into the window and back out.
  const pathMat = pathMaterial();
  const path = new Mesh(
    new TubeGeometry(
      new CatmullRomCurve3(
        [[-7, 0.02, 2.4], [-3.6, 0.02, 1.7], [-0.6, 0.02, 1.0], [0.47, 0.02, 0.55], [0.47, 0.9, 0.24], [0.47, 1.72, 0.13], [0.95, 1.2, 0.6], [2.2, 0.02, 1.5], [5.6, 0.02, 2.5]].map(
          (p) => new Vector3(...(p as [number, number, number])),
        ),
      ),
      240, 0.028, 6,
    ),
    pathMat,
  );
  street.group.add(path);

  // "Privacy": a dashed box around the street, the computer it runs on, and
  // requests leaving only to the left. Line distances drive dashes and drawing.
  const lines = (segs: number[][], dashed: boolean) => {
    const pos: number[] = [];
    const d: number[] = [];
    for (const [x0, y0, z0, x1, y1, z1] of segs as [number, number, number, number, number, number][]) {
      pos.push(x0, y0, z0, x1, y1, z1);
      d.push(0, dashed ? Math.hypot(x1 - x0, y1 - y0, z1 - z0) : 1);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aD', new BufferAttribute(new Float32Array(d), 1));
    const m = lineMaterial(dashed);
    const l = new LineSegments(g, m);
    street.group.add(l);
    return m;
  };
  const bx = [-3.45, 4.3];
  const bz = [-0.8, 1.3];
  const by = [0.01, 3.15];
  const box: number[][] = [];
  for (const y of by) {
    box.push([bx[0]!, y, bz[0]!, bx[1]!, y, bz[0]!], [bx[0]!, y, bz[1]!, bx[1]!, y, bz[1]!], [bx[0]!, y, bz[0]!, bx[0]!, y, bz[1]!], [bx[1]!, y, bz[0]!, bx[1]!, y, bz[1]!]);
  }
  for (const x of bx) for (const z of bz) box.push([x, by[0]!, z, x, by[1]!, z]);
  const boxMat = lines(box, true);
  const streakMat = lines(
    [[-3.45, 0.5, 0.9, -5.4, 0.5, 1.4], [-3.45, 1.2, 0.2, -5.6, 1.5, 0.3], [-3.45, 2.0, 0.6, -5.3, 2.5, 0.9], [-3.45, 2.7, -0.3, -5.1, 3.2, -0.5]],
    false,
  );

  // Camera and overlay.
  const rig = new CameraRig(innerWidth / innerHeight);
  const overlay = new Overlay(street);
  const sections: Section[] = [...document.querySelectorAll<HTMLElement>('section[data-key], footer[data-key]')].map((el) => ({ el, key: Number(el.dataset.key) }));
  const how = document.querySelector<HTMLElement>('[data-key="2"]');
  const measure = () => rig.measure(sections, innerHeight, document.documentElement.scrollHeight - innerHeight);
  measure();

  // State that changes with the scroll position.
  let themeMix = 0;
  let themeTo = 0;
  let allLit = false;
  let privacyDraw = stills ? 1 : 0;
  let privacyDrawing = false;
  let buildTo = feedState.build;
  let focused: number | null = null;
  let howProgress = 0;
  /** Watchdog level: 1 lowers the pixel ratio, 2 drops particles and halos. */
  let level = 0;

  themeMix = themeTo = isDark() ? 1 : 0;

  const lightBase = (instant: boolean) => {
    street.windows.forEach((_, i) => {
      const on = BASE.includes(i) || feedState.lit.has(i) || feedState.needs.has(i);
      if (feedState.needs.has(i)) street.setNeeds(i, instant);
      else street.setLit(i, on, instant);
    });
  };

  if (stills) {
    const k = stills.key;
    rig.fixed = stills.portrait ? PORTRAIT_KEY : KEYS[k]!;
    rig.t = rig.to = k;
    if (k >= 1) {
      for (const w of FEED_LIT) feedState.lit.add(w);
      for (const w of FEED_NEEDS) feedState.needs.add(w);
    }
    lightBase(true);
    if (k === 9) street.windows.forEach((_, i) => street.setLit(i, true, true));
    street.setBuild(k >= 8 ? 1 : 0);
    SEVENTH_LIT.forEach((i) => street.setLit(i, k >= 8, true, 1));
    howProgress = 1;
  } else {
    lightBase(true);
    street.setBuild(buildTo);
    rig.t = rig.to = rig.fromScroll(scrollY);
  }

  /** Everything that depends on the path position and the theme, applied before a render. */
  const applyState = () => {
    const t = rig.t;
    const nightK = stills ? (stills.key === 5 || stills.key === 9 ? 1 : 0) : smoothstep(8, 9, t);
    const mix = Math.max(themeMix, nightK);
    mixLook(dusk, night, mix, look);
    renderer.toneMappingExposure = look.exposure;
    scene.environment = envs[mix > 0.5 ? 1 : 0];
    scene.environmentIntensity = look.env;
    key.color.copy(look.key);
    key.intensity = look.keyI;
    rim.color.copy(look.rim);
    rim.intensity = look.rimI;
    facade.color.copy(look.metal);
    frame.color.copy(look.frame);
    street.setColors(look.lit, look.needs, look.glow);
    halo.uniforms.uStrength!.value = look.halo;
    const gm = grid.material;
    gm.uniforms.uColor!.value.copy(look.grid);
    gm.uniforms.uAlpha!.value = look.gridA;
    shadow.uniforms.uAlpha!.value = look.shadowA;
    const pm = particles.material;
    pm.uniforms.uColor!.value.copy(look.mote);
    const pa = stills ? (stills.key === 0 || stills.key === 9 ? 1 : 0) : Math.max(1 - smoothstep(0.3, 1, t), smoothstep(8, 9, t));
    pm.uniforms.uAlpha!.value = pa;
    particles.visible = pa > 0.001 && level < 2;
    halo.visible = level < 2;
    moteMat.uniforms.uColor!.value.copy(look.glow);
    // How it works.
    const pathA = stills ? (stills.key === 2 ? 1 : 0) : 1 - smoothstep(0.15, 0.45, Math.abs(t - 2));
    pathMat.uniforms.uAlpha!.value = pathA;
    pathMat.uniforms.uColor!.value.copy(look.glow);
    pathMat.uniforms.uProgress!.value = pathAt(howProgress);
    path.visible = pathA > 0.001;
    // Privacy.
    const privA = stills ? (stills.key === 6 ? 1 : 0) : 1 - smoothstep(0.4, 0.9, Math.abs(t - 6));
    for (const m of [boxMat, streakMat]) {
      m.uniforms.uColor!.value.copy(look.line);
      m.uniforms.uAlpha!.value = privA * 0.85;
    }
    streakMat.uniforms.uDraw!.value = privacyDraw;
    // Highlight: a focused hotspot, else the hero callout's window, else the inbox's needs-you window.
    const hi = focused ?? (t < 0.5 ? HERO : Math.abs(t - 4) < 0.5 ? NEEDS : null);
    street.showHighlight(stills && stills.key !== 0 && stills.key !== 4 ? null : hi);
    layer.classList.toggle('blur', Math.abs(t - 4) < 0.6);
  };

  // Shaders compile off the main thread where the browser supports it
  // (KHR_parallel_shader_compile). Where it does not, each object is compiled
  // in its own task, so no single compile blocks input for long.
  applyState();
  rig.apply();
  for (const part of [...street.group.children, ...scene.children.filter((o) => o !== street.group)]) {
    await renderer.compileAsync(part, rig.camera, scene);
    await yieldTask();
  }
  const vw = () => innerWidth;
  const vh = () => innerHeight;
  const render = () => {
    applyState();
    renderer.render(scene, rig.camera);
    if (!stills) overlay.update(rig.camera, rig.t, vw(), vh());
  };

  if (stills) {
    render();
    (window as unknown as { __stills: unknown }).__stills = {
      anchors: overlay.measure(rig.camera, stills.key, vw(), vh()),
      draws: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
    root.dataset.stillReady = '1';
    return { stop() {}, resume() {} };
  }

  // The loop.
  let running = false;
  let stopped = false;
  let visible = document.visibilityState === 'visible';
  let inView = 0;
  let last = 0;
  let ambientUntil = 0;
  let skip = 6;
  const deltas: number[] = [];
  const pulses: { at: number; win: number }[] = [];

  const active = () => !stopped && visible && inView > 0;
  const wake = () => {
    if (running || !active()) return;
    running = true;
    last = performance.now();
    skip = 6;
    renderer.setAnimationLoop(tick);
  };
  const sleep = () => {
    running = false;
    renderer.setAnimationLoop(null);
  };

  // Frame-time watchdog. With vsync, frames that miss the 16.7 ms budget show
  // up as intervals of two refreshes or more, so the 90th percentile of the
  // interval over 60 frames is the signal: above 20 ms lower the pixel ratio,
  // above 24 ms drop particles and halos, above 28 ms fall back to the posters.
  const watchdog = (ms: number) => {
    if (skip > 0) {
      skip--;
      return;
    }
    deltas.push(ms);
    if (deltas.length < 60) return;
    deltas.sort((a, b) => a - b);
    const p90 = deltas[53]!;
    deltas.length = 0;
    if (p90 > 28 && level >= 2) fallback();
    else if (p90 > 24 && level === 1) level = 2;
    else if (p90 > 20 && level === 0) {
      level = 1;
      dpr = 1;
      renderer.setPixelRatio(1);
      renderer.setSize(innerWidth, innerHeight, false);
    }
  };

  const fallback = () => {
    stopped = true;
    sleep();
    root.classList.remove('stage-live', 'stage-likely');
    root.classList.add('stage-off');
  };

  function tick(now: number) {
    const ms = now - last;
    const dt = Math.min(0.05, ms / 1000);
    last = now;
    let busy = rig.update(dt);
    if (street.update(dt)) busy = true;
    if (themeMix !== themeTo) {
      themeMix = themeTo > themeMix ? Math.min(themeTo, themeMix + dt / 0.6) : Math.max(themeTo, themeMix - dt / 0.6);
      busy = true;
    }
    // Motes in flight.
    if (flights.length) {
      const pos = moteGeo.getAttribute('position') as BufferAttribute;
      const alpha = moteGeo.getAttribute('aA') as BufferAttribute;
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i]!;
        f.t += dt / 0.9;
        const e = 1 - Math.pow(1 - Math.min(1, f.t), 3);
        const u = 1 - e;
        pos.setXYZ(f.slot, u * u * f.a.x + 2 * u * e * f.c.x + e * e * f.b.x, u * u * f.a.y + 2 * u * e * f.c.y + e * e * f.b.y, u * u * f.a.z + 2 * u * e * f.c.z + e * e * f.b.z);
        alpha.setX(f.slot, f.t < 1 ? Math.min(1, f.t * 4) : 0);
        if (f.t >= 1) {
          street.setLit(f.win, true);
          street.pulse(f.win);
          flights.splice(i, 1);
        }
      }
      pos.needsUpdate = alpha.needsUpdate = true;
      busy = true;
    }
    // Scheduled halo pulses (the intro).
    for (let i = pulses.length - 1; i >= 0; i--) {
      if (now >= pulses[i]!.at) {
        street.pulse(pulses[i]!.win);
        pulses.splice(i, 1);
      }
    }
    if (pulses.length) busy = true;
    // The footer lights every window; scrolling back restores the feed's state.
    const wantAll = rig.t > 8.6;
    if (wantAll !== allLit) {
      allLit = wantAll;
      const rnd = seeded(5);
      street.windows.forEach((_, i) => {
        if (BASE.includes(i) || feedState.lit.has(i) || feedState.needs.has(i)) return;
        if (allLit) pulses.push({ at: now + rnd() * 1200, win: i });
        street.setLit(i, allLit);
      });
      busy = true;
    }
    // The seventh house rises when the Contribute code block comes into view.
    if (street.built !== buildTo) {
      const b = buildTo > street.built ? Math.min(buildTo, street.built + dt / 0.9) : Math.max(buildTo, street.built - dt / 0.9);
      street.setBuild(b);
      SEVENTH_LIT.forEach((i, n) => street.setLit(i, b > 0.5 + n * 0.1, false, 1));
      busy = true;
    }
    if (privacyDrawing) {
      privacyDraw = Math.min(1, privacyDraw + dt / 1.4);
      if (privacyDraw >= 1) privacyDrawing = false;
      busy = true;
    }
    if (Math.abs(rig.t - 6) < 0.3 && privacyDraw === 0) privacyDrawing = true;
    // Ambient drift runs while the reader is doing something, then freezes.
    if (particles.visible && now < ambientUntil) {
      particles.material.uniforms.uTime!.value += dt;
      busy = true;
    }
    render();
    watchdog(ms);
    if (!busy && now >= ambientUntil) sleep();
  }

  // Inputs.
  const onScroll = () => {
    rig.to = rig.fromScroll(scrollY);
    if (how) {
      const r = how.getBoundingClientRect();
      howProgress = clamp01(-r.top / Math.max(1, r.height - innerHeight));
    }
    if (focused !== null && document.activeElement instanceof HTMLElement) {
      const r = document.activeElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) release();
    }
    ambientUntil = performance.now() + 1500;
    wake();
  };
  addEventListener('scroll', onScroll, { passive: true });

  const fine = matchMedia('(pointer: fine)');
  addEventListener(
    'pointermove',
    (e) => {
      if (!fine.matches || e.pointerType !== 'mouse') return;
      rig.parallax((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
      ambientUntil = performance.now() + 2000;
      wake();
    },
    { passive: true },
  );

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      renderer.setSize(innerWidth, innerHeight, false);
      rig.resize(innerWidth / innerHeight);
      measure();
      onScroll();
    }, 150);
  };
  addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(document.body);

  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
    if (visible) wake();
    else sleep();
  });

  const showing = new Set<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) showing.add(e.target);
      else showing.delete(e.target);
    }
    inView = showing.size;
    if (inView > 0) wake();
  });
  sections.filter((s) => !s.el.classList.contains('band')).forEach((s) => io.observe(s.el));

  addEventListener('nlpf:theme', () => {
    themeTo = isDark() ? 1 : 0;
    wake();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    themeTo = isDark() ? 1 : 0;
    wake();
  });

  // Hotspots: focusing or hovering a callout card frames its window.
  const tmpA = new Vector3();
  const release = () => {
    focused = null;
    rig.focus(null);
    wake();
  };
  for (const { card, win } of overlay.cards) {
    const grab = () => {
      focused = win;
      rig.focus(street.worldPos(win, tmpA).clone());
      wake();
    };
    card.addEventListener('focus', grab);
    card.addEventListener('blur', release);
    card.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && grab());
    card.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && document.activeElement !== card && release());
  }

  // Feed events from main.ts.
  let slot = 0;
  on((e) => {
    if (e.kind === 'found') {
      const b = street.worldPos(e.window, new Vector3());
      const n = street.normal(new Vector3());
      const a = b.clone().addScaledVector(n, 2.6).setY(0.05);
      const c = a.clone().lerp(b, 0.5).setY(b.y + 0.9);
      flights.push({ win: e.window, t: 0, a, b, c, slot: slot++ % MOTES });
    } else if (e.kind === 'needs-you') street.setNeeds(e.window);
    else if (e.kind === 'reset') e.windows.forEach((w) => street.setLit(w, BASE.includes(w)));
    else if (e.kind === 'pulse') e.windows.forEach((w) => street.pulse(w));
    else if (e.kind === 'build') buildTo = e.progress;
    wake();
  });

  canvas.addEventListener('webglcontextlost', fallback);
  // Development only (removed from production builds): lets a review script try camera poses over the real layout.
  if (import.meta.env.DEV) (window as unknown as { __nlpf: unknown }).__nlpf = { rig, wake, render, street };

  // First frame, then the crossfade from the identical poster.
  render();
  root.classList.add('stage-live');
  if (scrollY < 10) {
    root.classList.add('stage-intro');
    BASE.slice(0, 8).forEach((win, i) => pulses.push({ at: performance.now() + 250 + i * 200, win }));
  }
  onScroll();

  return {
    stop() {
      stopped = true;
      sleep();
      root.classList.remove('stage-live');
    },
    resume() {
      if (level >= 3) return;
      stopped = false;
      root.classList.add('stage-live');
      measure();
      onScroll();
    },
  };
}
