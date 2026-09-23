// Proof render of the Canal Light 3D centrepiece: an extruded row of six
// canal-house gables in scratched dark metal, white window frames, lit windows
// as listings, a Solais-style grid floor, soft particles, and one window that
// a DOM callout points at. Only named imports, so the bundle size is realistic.
import {
  WebGLRenderer, Scene, PerspectiveCamera, PMREMGenerator, Shape, ExtrudeGeometry,
  MeshPhysicalMaterial, MeshBasicMaterial, Mesh, Group, InstancedMesh, PlaneGeometry,
  BoxGeometry, Object3D, Color, CanvasTexture, RepeatWrapping, SRGBColorSpace,
  ACESFilmicToneMapping, DirectionalLight, ShaderMaterial, BufferGeometry,
  BufferAttribute, Points, AdditiveBlending, Vector3, DoubleSide, BackSide,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const q = new URLSearchParams(location.search);
const dark = q.get('theme') === 'dark';
const t0 = performance.now();

const canvas = document.getElementById('scene');
const W = canvas.clientWidth, H = canvas.clientHeight;
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W, H, false);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = dark ? 0.95 : 1.05;
renderer.outputColorSpace = SRGBColorSpace;

const scene = new Scene();
const pmrem = new PMREMGenerator(renderer);
// A procedural dusk environment: warm street glow low on the left, cool sky high on
// the right, so the metal reflects the page gradient. Replaces a downloaded HDR/EXR
// (Solais ships a 1.39 MB environment.exr).
function duskEnv() {
  const s = new Scene();
  s.add(new Mesh(new BoxGeometry(30, 30, 30), new MeshBasicMaterial({ color: new Color(dark ? '#060B0B' : '#2B2A27'), side: BackSide })));
  const panel = (hex, k, pos, w, h) => { const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(k), side: DoubleSide })); m.position.set(...pos); m.lookAt(0, 1, 0); s.add(m); };
  panel('#FF7A33', dark ? 5 : 4, [-9, 0.5, 7], 10, 4);
  panel('#FFB26B', 2.2, [-3, 6, 9], 6, 2);
  panel(dark ? '#3A607A' : '#A9C1D6', dark ? 3 : 2.4, [8, 9, -5], 12, 6);
  panel('#F5F2EA', dark ? 1.2 : 3.0, [10, 4, 10], 14, 10);
  panel('#FF9A4D', dark ? 2.0 : 2.4, [-2, -3, 10], 12, 3);
  return pmrem.fromScene(s, 0.03).texture;
}
scene.environment = duskEnv();
scene.environmentIntensity = dark ? 0.9 : 1.0;

const camera = new PerspectiveCamera(22, W / H, 0.1, 100);
camera.position.set(-6.2, 3.1, 14.2);
camera.lookAt(0.55, 0.95, 0);

// Scratched metal: a procedural roughness and bump map, drawn once on a canvas (0 bytes downloaded).
function scratchTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(118,118,118)'; g.fillRect(0, 0, 512, 512);
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 512, y = rnd() * 512, a = rnd() * Math.PI, l = 6 + rnd() * 60;
    const v = rnd() < 0.5 ? 60 + rnd() * 40 : 170 + rnd() * 60;
    g.strokeStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.5})`; g.lineWidth = rnd() < 0.9 ? 0.6 : 1.4;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(2.5, 2.5);
  return t;
}
const scratches = scratchTexture();

const facade = new MeshPhysicalMaterial({
  color: new Color(dark ? '#2E4845' : '#34504C'), metalness: 0.7, roughness: 0.34,
  roughnessMap: scratches, bumpMap: scratches, bumpScale: 5,
  clearcoat: 1.0, clearcoatRoughness: 0.12,
});

// Six gable profiles, 1 unit is roughly one house width. Order along the street:
// step (trapgevel), neck (halsgevel), bell (klokgevel), spout (tuitgevel), cornice (lijstgevel), wide step.
function poly(pts) { const s = new Shape(); s.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], pts[i + 1]); s.closePath(); return s; }
function mirror(half) { // half: list of [x,y] from right bottom to top centre; mirrored to the left.
  const r = half.flat(); const l = half.slice().reverse().map(([x, y]) => [-x, y]).flat();
  return poly([...r, ...l]);
}
const profiles = [
  { w: 1.0, eave: 1.9, shape: mirror([[0.5, 0], [0.5, 1.9], [0.38, 1.9], [0.38, 2.12], [0.26, 2.12], [0.26, 2.34], [0.14, 2.34], [0.14, 2.56], [0, 2.56]]) },
  { w: 0.9, eave: 1.98, shape: mirror([[0.45, 0], [0.45, 1.98], [0.2, 2.18], [0.2, 2.58], [0.12, 2.64], [0, 2.74]]) },
  { w: 0.95, eave: 1.8, shape: (() => { const s = new Shape(); s.moveTo(-0.475, 0); s.lineTo(0.475, 0); s.lineTo(0.475, 1.8); s.quadraticCurveTo(0.26, 1.9, 0.22, 2.3); s.absarc(0, 2.3, 0.22, 0, Math.PI, false); s.quadraticCurveTo(-0.26, 1.9, -0.475, 1.8); s.closePath(); return s; })() },
  { w: 0.85, eave: 2.02, shape: mirror([[0.425, 0], [0.425, 2.02], [0.1, 2.5], [0.1, 2.64], [0, 2.64]]) },
  { w: 1.1, eave: 2.06, shape: mirror([[0.55, 0], [0.55, 2.06], [0.6, 2.09], [0.6, 2.18], [0, 2.18]]) },
  { w: 1.15, eave: 1.72, shape: mirror([[0.575, 0], [0.575, 1.72], [0.46, 1.72], [0.46, 1.9], [0.34, 1.9], [0.34, 2.08], [0.22, 2.08], [0.22, 2.26], [0.1, 2.26], [0.1, 2.44], [0, 2.44]]) },
];

const street = new Group();
const depth = 0.42;
const windows = []; // {x, y, w, h, lit}
let x = -3.05;
profiles.forEach((p, i) => {
  const geo = new ExtrudeGeometry(p.shape, { depth, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 5, curveSegments: 20 });
  geo.translate(0, 0, -depth);
  const m = new Mesh(geo, facade);
  const cx = x + p.w / 2; m.position.x = cx; street.add(m);
  const cols = p.w > 1.0 ? 3 : 2; const floors = [0.95, 1.38, p.eave - 0.3];
  for (const fy of floors) for (let c = 0; c < cols; c++) {
    const wx = cx + (c - (cols - 1) / 2) * (p.w / (cols + 0.25));
    windows.push({ x: wx, y: fy, w: 0.15, h: 0.25 });
  }
  windows.push({ x: cx - p.w * 0.22, y: 0.36, w: 0.15, h: 0.42, door: true });
  windows.push({ x: cx + p.w * 0.18, y: 0.42, w: 0.24, h: 0.3 });
  windows.push({ x: cx, y: p.eave + 0.25, w: 0.12, h: 0.18 }); // gable window
  x += p.w + 0.02;
});
street.rotation.y = 0.5;
street.position.set(0.9, 0, 0.4);
scene.add(street);

// Lit pattern: fixed, so light and dark renders match. Index 17 is the callout window.
const LIT = new Set([2, 5, 9, 12, 20, 26, 31, 32, 34, 38, 42, 47, 50, 56]);
const CALLOUT = 32;
const frameGeo = new BoxGeometry(1, 1, 0.03);
const paneGeo = new PlaneGeometry(1, 1);
const frameMat = new MeshPhysicalMaterial({ color: new Color(dark ? '#C9C2B2' : '#EDE6D6'), roughness: 0.55, metalness: 0.0 });
const glassMat = new MeshPhysicalMaterial({ color: new Color('#0B1414'), roughness: 0.08, metalness: 0.2, clearcoat: 1 });
const litMat = new MeshBasicMaterial({ color: new Color(dark ? '#FFB066' : '#FF9A4D').multiplyScalar(1.25), toneMapped: false });
const frames = new InstancedMesh(frameGeo, frameMat, windows.length);
const panesOff = new InstancedMesh(paneGeo, glassMat, windows.length);
const panesOn = new InstancedMesh(paneGeo, litMat, windows.length);
const o = new Object3D(); let nOn = 0, nOff = 0;
windows.forEach((w, i) => {
  o.position.set(w.x, w.y, 0.05); o.scale.set(w.w + 0.05, w.h + 0.05, 1); o.updateMatrix(); frames.setMatrixAt(i, o.matrix);
  o.position.z = 0.068; o.scale.set(w.w, w.h, 1); o.updateMatrix();
  if (LIT.has(i) && !w.door) panesOn.setMatrixAt(nOn++, o.matrix); else panesOff.setMatrixAt(nOff++, o.matrix);
});
panesOn.count = nOn; panesOff.count = nOff;
street.add(frames, panesOff, panesOn);

// Glow halos behind lit windows: additive camera-facing points with a soft falloff (no bloom pass).
const haloPos = [];
windows.forEach((w, i) => { if (LIT.has(i) && !w.door) haloPos.push(w.x, w.y, 0.09); });
const halo = new Points(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(haloPos), 3)), new ShaderMaterial({
  transparent: true, depthWrite: false, blending: AdditiveBlending,
  uniforms: { uColor: { value: new Color('#FF8A3D') }, uSize: { value: 1100 * renderer.getPixelRatio() }, uStrength: { value: dark ? 0.8 : 0.7 } },
  vertexShader: 'uniform float uSize; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = uSize / -mv.z; gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'uniform vec3 uColor; uniform float uStrength; void main(){ float d = length(gl_PointCoord-.5)*2.; float a = pow(max(0.,1.-d),2.2)*uStrength; gl_FragColor = vec4(uColor*a, a); }',
}));
street.add(halo);

// Callout highlight: a thin emissive outline around the chosen window (instead of an OutlinePass).
{
  const w = windows[CALLOUT];
  const ring = new Mesh(new PlaneGeometry(w.w + 0.16, w.h + 0.16), new ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide,
    uniforms: { uAspect: { value: (w.w + 0.16) / (w.h + 0.16) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec2 vUv; void main(){ vec2 d = abs(vUv-.5)*2.; float e = max(d.x, d.y); float line = smoothstep(.86,.9,e) * (1.-smoothstep(.95,1.,e)); gl_FragColor = vec4(vec3(1.), line*.95); }',
  }));
  ring.position.set(w.x, w.y, 0.09); street.add(ring);
}

// Lights: warm low key from the street side, cool rim from behind (sky).
const key = new DirectionalLight(new Color('#FFB26B'), dark ? 3.0 : 3.2); key.position.set(-4, 2.2, 6); scene.add(key);
const rim = new DirectionalLight(new Color(dark ? '#5E8FB0' : '#A9C1D6'), dark ? 3.0 : 2.2); rim.position.set(4, 5, -6); scene.add(rim);

// Grid floor: anti-aliased lines with plus markers and a radial fade (Solais pattern, rewritten).
const grid = new Mesh(new PlaneGeometry(40, 40), new ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uColor: { value: new Color(dark ? '#9AB3B0' : '#FFFFFF') }, uAlpha: { value: dark ? 0.22 : 0.55 } },
  vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vP;
    float gridLine(vec2 p){ vec2 g = abs(fract(p-.5)-.5)/fwidth(p); return 1.-min(min(g.x,g.y),1.); }
    float plusMark(vec2 p){ vec2 c = p - floor(p/2.+.5)*2.; vec2 a = abs(c); float arm = step(a.x,.012)*step(a.y,.09) + step(a.y,.012)*step(a.x,.09); return clamp(arm,0.,1.); }
    void main(){ vec2 p = vP*1.4; float l = gridLine(p)*.55 + plusMark(p); float fade = 1.-smoothstep(3.,14.,length(vP)); gl_FragColor = vec4(uColor, clamp(l,0.,1.)*uAlpha*fade); }`,
}));
grid.rotation.x = -Math.PI / 2; grid.position.y = -0.001; scene.add(grid);

// Particles: slow "listing" motes, warm, additive, size-attenuated.
{
  const N = 260; const pos = new Float32Array(N * 3); const size = new Float32Array(N);
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) { pos[i * 3] = (rnd() - 0.5) * 12; pos[i * 3 + 1] = rnd() * 4.2; pos[i * 3 + 2] = (rnd() - 0.3) * 7; size[i] = 1 + rnd() * rnd() * 7; }
  const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(pos, 3)); g.setAttribute('size', new BufferAttribute(size, 1));
  scene.add(new Points(g, new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(dark ? '#FFC38A' : '#FFE1BF') }, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: 'attribute float size; uniform float uPR; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*uPR*(12./-mv.z); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 uColor; void main(){ float d = length(gl_PointCoord-.5)*2.; float a = smoothstep(1.,.2,d)*.75; gl_FragColor = vec4(uColor*a, a); }',
  })));
}

renderer.render(scene, camera);

// Project anchors for the DOM overlay: the callout window and a few data labels.
street.updateMatrixWorld(true);
const toScreen = v => { const p = v.clone().applyMatrix4(street.matrixWorld).project(camera); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H }; };
const cw = windows[CALLOUT];
const anchor = toScreen(new Vector3(cw.x, cw.y, 0.09));
const labelAnchors = [5, 20, 50, 56].map(i => toScreen(new Vector3(windows[i].x, windows[i].y + 0.25, 0.05)));
window.__proof = { anchor, labelAnchors, firstFrameMs: Math.round(performance.now() - t0), windows: windows.length, lit: nOn, draws: renderer.info.render.calls, tris: renderer.info.render.triangles };
document.dispatchEvent(new CustomEvent('scene-ready', { detail: window.__proof }));
