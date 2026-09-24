/*
 * Every material in the Street. Textures are drawn on a canvas at start-up from
 * a seeded random sequence, so nothing is downloaded and the rendered posters
 * match the live scene pixel for pixel. Shaders are short and written for this
 * scene only: no post-processing passes, glow comes from additive points.
 */
import {
  AdditiveBlending, CanvasTexture, Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial,
  NormalBlending, RepeatWrapping, ShaderMaterial, type Texture,
} from 'three';

/** Lehmer generator: the same sequence on every machine. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Scratched metal over faint brick coursing, used as roughness and bump map.
 * Mid grey is neutral; lighter strokes are rougher and raised.
 */
export function facadeTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const rnd = seeded(7);
  g.fillStyle = 'rgb(122,122,122)';
  g.fillRect(0, 0, 512, 512);
  // Brick coursing: dark mortar lines every 16 px, joints offset by half a
  // brick on alternate rows. Faint, so it reads as texture on the fronts.
  g.fillStyle = 'rgba(88,88,88,0.4)';
  for (let y = 0; y < 512; y += 16) {
    g.fillRect(0, y, 512, 2);
    const off = (y / 16) % 2 ? 24 : 0;
    for (let x = off; x < 512; x += 48) g.fillRect(x, y, 2, 16);
  }
  // Mottling, so the metal is not uniformly rough.
  for (let i = 0; i < 160; i++) {
    const v = 100 + rnd() * 60;
    g.fillStyle = `rgba(${v},${v},${v},0.08)`;
    g.beginPath();
    g.arc(rnd() * 512, rnd() * 512, 10 + rnd() * 50, 0, Math.PI * 2);
    g.fill();
  }
  // Scratches: short seeded strokes, most thin, a few deeper.
  for (let i = 0; i < 1100; i++) {
    const x = rnd() * 512, y = rnd() * 512, a = rnd() * Math.PI, l = 6 + rnd() * 64;
    const v = rnd() < 0.5 ? 50 + rnd() * 40 : 175 + rnd() * 60;
    g.strokeStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.5})`;
    g.lineWidth = rnd() < 0.9 ? 0.6 : 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(2.2, 2.2);
  t.anisotropy = 4;
  return t;
}

export function facadeMaterial(map: Texture): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: new Color(),
    metalness: 0.7,
    roughness: 0.36,
    roughnessMap: map,
    bumpMap: map,
    bumpScale: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    // Vertex colours carry a vertical ambient-occlusion gradient: darker at
    // street level, so the fronts read as more than a flat dark plane.
    vertexColors: true,
  });
}

export function frameMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(), roughness: 0.5, metalness: 0 });
}

/**
 * Window panes, one instanced mesh for all of them. Each instance colour is
 * the pane's light: black is a dark window, warm is lit, the needs-you colour
 * blinks. It is routed to emissive instead of tinting the dark glass, so a
 * window can ramp from dark to lit without swapping meshes.
 */
export function paneMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color(),
    roughness: 0.08,
    metalness: 0.25,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <color_fragment>',
      '#if defined( USE_COLOR )\n totalEmissiveRadiance += vColor.rgb;\n#endif',
    );
  };
  return m;
}

/** Glow behind lit windows: camera-facing points with a soft falloff, no bloom pass. */
export function haloMaterial(pixelRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uSize: { value: 1100 * pixelRatio }, uStrength: { value: 0.7 } },
    vertexShader: `attribute float aLit; attribute float aPulse; attribute vec3 aCol;
      uniform float uSize; varying float vA; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vA = aLit; vC = aCol;
        gl_PointSize = uSize*aPulse/-mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uStrength; varying float vA; varying vec3 vC;
      void main(){ if (vA < .01) discard; float d = length(gl_PointCoord-.5)*2.;
        float a = pow(max(0.,1.-d),2.2)*uStrength*vA; gl_FragColor = vec4(vC*a, a); }`,
  });
}

/** A frame-only quad around the highlighted window, instead of an outline pass. */
export function highlightMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
    uniforms: { uAlpha: { value: 0.95 }, uColor: { value: new Color() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float uAlpha; uniform vec3 uColor; varying vec2 vUv;
      void main(){ vec2 d = abs(vUv-.5)*2.; float e = max(d.x,d.y);
        float line = smoothstep(.84,.89,e)*(1.-smoothstep(.95,1.,e)); gl_FragColor = vec4(uColor, line*uAlpha); }`,
  });
}

/**
 * The perspective grid floor: anti-aliased lines from screen-space
 * derivatives, a plus mark every two cells and a radial fade.
 */
export function gridMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0.55 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vP;
      float gridLine(vec2 p){ vec2 g = abs(fract(p-.5)-.5)/fwidth(p); return 1.-min(min(g.x,g.y),1.); }
      float plusMark(vec2 p){ vec2 c = p - floor(p/2.+.5)*2.; vec2 a = abs(c);
        return clamp(step(a.x,.012)*step(a.y,.09) + step(a.y,.012)*step(a.x,.09), 0., 1.); }
      void main(){ vec2 p = vP*1.4; float l = gridLine(p)*.55 + plusMark(p);
        float fade = 1.-smoothstep(3.,14.,length(vP)); gl_FragColor = vec4(uColor, clamp(l,0.,1.)*uAlpha*fade); }`,
  });
}

/** A soft dark pool under the row, so the houses sit on the grid. */
export function shadowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: { uAlpha: { value: 0.32 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float uAlpha; varying vec2 vUv;
      void main(){ vec2 d = (vUv-.5)*2.; float r = length(vec2(d.x*.55, d.y));
        float a = (1.-smoothstep(.15,1.,r))*uAlpha; gl_FragColor = vec4(0.,0.,0.,a); }`,
  });
}

/**
 * Motes: size-attenuated additive points. `uTime` moves them upward slowly;
 * it only advances while the render loop runs, so they freeze at rest.
 */
export function particleMaterial(pixelRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color() }, uPR: { value: pixelRatio }, uTime: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: `attribute float size; uniform float uPR; uniform float uTime;
      void main(){ vec3 p = position; p.y = mod(p.y + uTime*(.05 + size*.01), 4.4);
        p.x += sin(uTime*.3 + position.z*2.)*.08;
        vec4 mv = modelViewMatrix*vec4(p,1.); gl_PointSize = size*uPR*(12./-mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha;
      void main(){ float d = length(gl_PointCoord-.5)*2.; float a = smoothstep(1.,.2,d)*.75*uAlpha; gl_FragColor = vec4(uColor*a, a); }`,
  });
}

/** One bright point per moving listing mote (section 2 events). */
export function moteMaterial(pixelRatio: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color() }, uPR: { value: pixelRatio } },
    vertexShader: `attribute float aA; uniform float uPR; varying float vA;
      void main(){ vA = aA; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = 90.*uPR/-mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ if (vA < .01) discard; float d = length(gl_PointCoord-.5)*2.;
        float a = (pow(max(0.,1.-d),3.)+smoothstep(.25,.0,d))*vA; gl_FragColor = vec4(uColor*a, a); }`,
  });
}

/**
 * The path of "How it works", drawn along a tube. `uProgress` reveals
 * it from the sites on the left to the window and back out, with a bright head.
 */
export function pathMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: { uProgress: { value: 0 }, uColor: { value: new Color() }, uAlpha: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform float uProgress; uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
      void main(){ float x = vUv.x; if (x > uProgress) discard;
        float head = smoothstep(uProgress-.06, uProgress, x);
        gl_FragColor = vec4(mix(uColor, vec3(1.), head*.6), (.85 + head*.15)*uAlpha); }`,
  });
}

/**
 * Thin lines for the Privacy section: the dashed "your computer" box
 * (`dashed`, dash length from the distance along each edge) and the outgoing
 * requests, revealed from the box outward by `uDraw` (0 to 1 along each line).
 */
export function lineMaterial(dashed: boolean): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    defines: dashed ? { DASHED: 1 } : {},
    uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0 }, uDraw: { value: 1 } },
    vertexShader: `attribute float aD; varying float vD;
      void main(){ vD = aD; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; uniform float uDraw; varying float vD;
      void main(){
      #ifdef DASHED
        if (mod(vD, .2) > .12) discard;
      #else
        if (vD > uDraw) discard;
      #endif
        gl_FragColor = vec4(uColor, uAlpha); }`,
  });
}
