# nl-property-finder: 3D appendix to the Canal Light brief

> Raw probe outputs and working files mentioned below under `scratchpad/` were not committed; the findings they support are recorded here.

Scope: extends `canal-light.md` (Canal Light) with a WebGL layer, the Solais visual grammar the owner asked for, and a scroll story for the one-page site in `site/` (Vite, GitHub Pages). The local dashboard keeps the shared tokens and type grammar but gets no WebGL.

Evidence: 61 sites probed on 2026-09-23 (Solais plus 60 candidates), 19 selected and captured again with extra checks, a teardown of Solais's bundle and shaders, measured library and font sizes, and a working proof render of the proposed centrepiece (`refs/99-proof-3d-light.webp`, `refs/99-proof-3d-dark.webp`, source in `docs/design/proto3d/`).

What this appendix changes in the base brief:

| Base brief said | This appendix says |
|---|---|
| No video, canvas or WebGL (§8) | A lazy WebGL layer ("the Street") loads after first paint on capable devices. The page stays complete without it. |
| No smooth-scroll library, no parallax (§8) | Native scroll stays. The camera is scrubbed with a short lag (`scrub: 0.8`), which reads as smoothness without taking over the wheel. Lenis is an option that stays off by default (§5.5). Cursor parallax only moves the 3D camera. |
| Instrument Serif h1 and h2, ink on paper, pane on the right | Full-bleed hero on a warm-to-paper bleed. The h1 mixes uppercase JetBrains Mono with one Instrument Serif italic word. h2s are uppercase mono. |
| Pill buttons, floating glass nav | Slash-separated uppercase mono nav, a clipped-corner primary button, label chips with two bars. |
| No-build Pages deploy | Vite build in CI, `dist/` uploaded (§7.8). |

Everything else in the base brief stands: tokens, the dark theme declared twice, the skip link, the theme toggle, the copy rules, the dashboard layout and the logo.

---

## 0. The decision on one screen

1. **Keep Canal Light and add the Street.** The centrepiece is an extruded row of six canal-house gables in scratched dark metal with white window frames. Each lit window is a listing the agent found. It is Solais's extruded mark translated into this project's own motif, and the proof render shows it works at 13 draw calls and 4,420 triangles.
2. **Take Solais's grammar and leave its costs.** Take: uppercase mono, slash nav, label chips, the two-line headline with an indent rule, bracketed callouts with a blinking square, callout lines from 3D to text, floating data labels, a perspective grid floor, particles, grain, and the warm bleed. Leave: the loading gate, the 1.39 MB EXR, five render loops, a scramble that never stops, and nothing to see without JS.
3. **Win on what can be measured.** LCP under 1.5 s on a throttled mid laptop, against 4.7 s for Solais on a fast one. 0 requestAnimationFrame callbacks per second when nothing moves, against 305. Full content without JS. Reduced motion respected (2 of the 19 references do). Every 3D hotspot reachable by keyboard. Text stays text.
4. **Stack.** Plain TypeScript and Vite. three.js is loaded with `import()` after first paint: 143 KB gzip measured for the proof scene. GSAP core with ScrollTrigger, SplitText and ScrambleText is about 53 KB gzip measured, free for this use (checked, §6). No React, no React Three Fiber, no Spline runtime.
5. **Budget.** First view without 3D is about 190 KB transferred. With motion and 3D it is about 405 KB. The median reference ships 1,250 KB of JavaScript alone (§7.7).

---

## 1. Method

- Playwright-core 1.63 driving Chromium 151 headless, with ANGLE on Vulkan so WebGL ran on the machine's Intel Arc GPU. The renderer string was checked; default headless Chromium falls back to SwiftShader, which would distort every WebGL timing. Viewport 1440x900, DPR 1, cold cache and a fresh context per site, no network throttling, an Amsterdam fibre line, 2026-09-23.
- **FCP and LCP** from the Performance API (`paint` and `largest-contentful-paint` entries). **First WebGL** is the time of the first `getContext('webgl'|'webgl2')` call, from a wrapper injected before page scripts.
- **JS KB** is the compressed transfer size (headers plus body) of every script response in the first 10 s, lazy chunks included. **All KB** is every response in that window, which is why video-heavy sites show tens of megabytes.
- **Libraries** are detected by exact strings in the downloaded JS: `__THREE__` and the three.js revision, `__r3f`, `scrollTrigger`, `SplitText`, `scrambleText` and so on. A first pass used looser patterns; only names confirmed in the second pass are quoted. Sites that bundle a library they do not use in view still count as using it.
- **Reduced motion** is measured as requestAnimationFrame callbacks per second over 2 idle seconds, once normally and once with `reducedMotion: 'reduce'`. It is a proxy: a loop can run for reasons other than motion, but a WebGL loop that keeps going means the scene keeps animating.
- **No JS** means a load with JavaScript disabled, then a screenshot and the length of the visible text.
- **Screenshots**: the hero after about 8 s (cookie banners dismissed where a button matched, the cursor swept across the hero), then a section after scrolling about 2,160 px with wheel events so Lenis and ScrollTrigger respond as they would to a person.

Caveats: a fast GPU and a fast line flatter every site, so read the numbers as comparisons, not as what a mid laptop sees. Sites change weekly.

---

## 2. Solais, measured

The owner's favourite, taken apart so the upgrade can match it feature for feature. Screenshots: `refs/06-solais-hero.webp`, `refs/06-solais-section.webp`. Scroll frames: `scratchpad/p3d/solais/sheet.jpg`.

**Stack.** A WordPress theme (`startdigital`) with jQuery 3.7.1 and Gravity Forms scripts. One `site.js` of 1.97 MB decoded bundles three.js r173, GSAP 3.12.5 (ScrollTrigger, SplitText, ScrambleTextPlugin, ScrollSmoother, Observer) and Lenis 1.1.20. Google Tag Manager adds 293 KB. Fonts are "ki" and "teknolog" from Typekit, both commercial.

**Timing (fast machine).** TTFB about 1.0 s, FCP 2.7 to 2.8 s, first WebGL context 3.5 to 3.8 s, LCP 4.7 to 5.0 s. The LCP element is the h1's second line ("IN AI SEARCH"), which paints only after the loader clears. CLS 0.01 to 0.025.

**Weight.** 758 KB of JS. 3.7 MB in total, including `environment.exr` at 1,390 KB, `solias.glb` at 73 KB, `solias_button_2.glb` at 156 KB, `tile.glb` at 16 KB, and the Draco decoder wasm at 87 KB, fetched from gstatic.com.

**The scene, from its 26 shader programs.**
- The logo uses three's `MeshPhysicalMaterial`: clearcoat, a roughness map for the scratches, a normal map, and an environment from the EXR through PMREM.
- The red-to-paper background is a shader that mixes four colours with sine bands (`smoothstep` over `sin(uv.x*25.)`), their direction rotated by 3D value noise that moves with time.
- The grid floor is an anti-aliased grid computed from `dFdx`/`dFdy`, with a plus marker drawn every 2 cells from a signed-distance plus shape and a radial fade.
- Particles are `Points` with size attenuation: `gl_PointSize = size * (300.0 / -mvPosition.z)`.
- The highlighted piece gets a white glow from an `EffectComposer` with `OutlinePass`. A blur pass sits alongside.

**Scroll.** One GSAP timeline drives the whole story: `scrollTrigger: { trigger: "#hero-section", start: "top top", end: "+=1550%", scrub: true, pin: true, pinSpacing: false }`. Fifteen and a half viewports of scroll drive a single scene. It opens with a pixel-mosaic transition, then moves the camera around the mark while one piece is outlined and annotated. A perspective grid appears, then a white section of floating tiles, then the mark rebuilt as white extruded steps with red icon tiles, then dark sections with the product screenshot and clipped cards.

**Callouts.** The text boxes are DOM (`.mesh-label`): a 12px square with a blinking inner square, an uppercase h3, and a mono paragraph, behind a bracket border. The connecting line is a three.js `Line2` fat line with a small diamond plane at the mesh end. Its far end is found by unprojecting the label's screen edge back into 3D.

**Floating labels.** 72 canvas-2D contexts draw text textures in teknolog, for example `// GENERATIVE ENGINE OPTIMISATION (GEO)` over coordinates such as `[-0.75, 0.00, -0.75]`. They scramble through random glyphs before they settle.

**Scramble.** ScrambleText over SplitText characters with `chars: "01{}[]()<>!@#$%^&*+=|/"` on a `repeat: -1` timeline. It never stops: a mutation observer counted 384 text changes per element in about 10 s.

**Motion cost.** 305 requestAnimationFrame callbacks per second, roughly five independent 60 fps loops (the GSAP ticker, Lenis, ScrollSmoother, three.js, the scramble). The figure is identical with reduced motion on. Neither the CSS nor the JS mentions `prefers-reduced-motion`.

**Without JS.** A "Loading..." screen that never goes away (`scratchpad/p3d/final/_solais-nojs.jpg`), although 4,329 characters of text are in the HTML.

**What it does well.** A skip link, a real h1, an OG image at 1200x675 in 13 KB, and a strong, consistent grammar.

What to beat: the loader gate, LCP, weight, the missing reduced-motion support, the empty no-JS state, the endless scramble, and five loops where one would do.

---

## 3. The new references

### 3.1 Selected (19)

Screenshots are in `refs/` as `11-<name>-hero.png` and `11-<name>-section.png`.

| # | Site | What it is | Why it is here |
|---|---|---|---|
| 1 | Igloo Inc, igloo.inc | Holding company for consumer brands in AI and crypto | Scroll-scrubbed camera through a 3D world: an igloo assembles from blocks, then ice objects carry mono annotations and callout lines, a glowing portal ring and a figure made of particles. "Sound: Off" toggle. Everything, text included, is drawn in WebGL. |
| 2 | Extropic, extropic.ai | Thermodynamic computing hardware | Grainy golden noise panels, glowing display type mixed with thin serif capitals, crosshair corner frames, a footer grid of glyphs that light up (close to the lit-windows idea), a big marquee headline. Its server-rendered poster is the best no-JS state in the set. |
| 3 | Oryzo, oryzo.ai | Lusion's parody "AI" cork coaster | One 3D object carried through every section: it rotates, flips and gets reframed by blueprint frames with crosshair corners, alongside giant sliding type. Its line "ISN'T JUST A COASTER" is exactly the construction the copy rules ban. |
| 4 | Lusion, lusion.co | The studio behind Oryzo | Cursor-reactive physics hero of glossy shapes, a line that draws itself on scroll, plus-sign grid marks, a percent preloader, a MUTE toggle. |
| 5 | Modal, modal.com | AI infrastructure | Glowing glass cube with transmission and particles in the hero, green on black. |
| 6 | Raycast, raycast.com | Launcher | WebGL ribbon shader behind centred type. Blinking UI vignettes further down. |
| 7 | Resend, resend.com | Email API | Monochrome 3D cube (a Spline scene, 2.7 MB `.splinecode`, with mp4 fallbacks) beside a serif headline. |
| 8 | Spline, spline.design | 3D design tool | Soft floating 3D shapes over a perspective grid floor, with a prompt box in the hero. |
| 9 | World Labs, worldlabs.ai | Spatial-intelligence models | Interactive 3D machine with a "Click to explore" chip. Gaussian splat scenes (five `.spz` files of about 1.4 MB each in the first 10 s). |
| 10 | Hebbia, hebbia.com | AI for finance | Dark 3D radial fan in warm light, uppercase serif display, bento with floating cards and a marquee. One of two sites whose loop stops under reduced motion. |
| 11 | Composio, composio.dev | Tool access for agents | Equaliser-bar shader field beside the hero, grain and bloom in the shaders, mono uppercase buttons, a numbered tab list. |
| 12 | Krea, krea.ai | Generative media | Particle starfield swirling around the prompt field. The other site whose loop stops under reduced motion. |
| 13 | Shopify Editions, shopify.com/editions | Product release pages | 3D shelf of edition "records" with baked lighting (48 KB glb). The Spring '26 edition scatters a painting into a point cloud and wraps decoding type around a cylinder (see the section shot). |
| 14 | basement.studio | Studio | A whole 3D office rendered live (R3F, three r180), "Turn music off", KTX2 textures. |
| 15 | Active Theory, activetheory.net | Studio | Own engine: glass logo with particles, curl-noise shaders driven by mouse and scroll uniforms, glyph fields that decode, an audio toggle. |
| 16 | Abstract Intelligence, abstract-intelligence.com | Report on AI in art and culture | 3D marble bust in clouds, a pixel display face, framed cards. The lightest JS in the set (221 KB). |
| 17 | Unicorn Studio, unicorn.studio | Tool for WebGL shader effects | The effects many AI-startup heroes use (Cognition's site loads its runtime). Dither, fbm, raymarching, chromatic aberration and bloom shaders. |
| 18 | TwelveLabs, twelvelabs.io | Video understanding models | 3D helix of video tiles (three r136) over dark ground. The alpha videos weigh 2.4 to 4.3 MB each. |
| 19 | Lovable, lovable.dev | App builder | The common AI-startup WebGL gradient hero, rendered as a single frame (0 requestAnimationFrame calls per second), with a typing placeholder. |

### 3.2 Measured (final pass; Solais for comparison)

Times in ms. "rAF/s" is requestAnimationFrame callbacks per second at idle, normally and with reduced motion. "No-JS text" is the visible characters with JavaScript off.

| Site | FCP | LCP (element) | First WebGL | JS KB | All KB in 10 s | rAF/s normal, reduced | No-JS text | Libraries found in the JS |
|---|---|---|---|---|---|---|---|---|
| Solais (reference) | 2792 | 4712 (span) | 3503 | 758 | 3,721 | 305, 305 | 4,329 | three r173, gsap, ScrollTrigger, SplitText, ScrambleText, ScrollSmoother, lenis, draco, ktx2 |
| Igloo Inc | 472 | 1084 (CSS ::before) | 558 | 422 | 17,037 | 61, 60 | 0 | three r165, gsap, ScrollTrigger, CustomEase, draco, ktx2 |
| Extropic | 184 | 7460 (p) | 431 | 796 | 5,373 | 300, 182 | 2,363 | three r178, r3f, lenis, lottie |
| Oryzo (Lusion) | 1380 | 3704 (img) | 1418 | 625 | 17,482 | 51, 41 | 6,585 | three r178, gsap, SplitText, rive, splat |
| Lusion | 184 | 228 (h1) | 308 | 789 | 15,386 | 60, 60 | 2,209 | three r158 |
| Modal | 1452 | 1620 (h1) | 1558 | 1027 | 10,931 | 121, 120 | 5,768 | three r180, gsap, ScrollTrigger, lottie, draco, ktx2 |
| Raycast | 680 | 912 (h1) | 1370 | 1250 | 6,039 | 49, 40 | 8,343 | three r185, r3f, draco, ktx2 |
| Resend | 608 | 804 (img) | 2608 | 3171 | 13,067 | 222, 240 | 14,500 | three r149, spline, draco |
| Spline | 220 | 1048 (div) | 1097 | 2909 | 26,665 | 420, 424 | 5,320 | three r149, spline, draco |
| World Labs | 356 | 356 (h1) | 644 | 2650 | 17,816 | 186, 125 | 2,857 | three r170, r3f, gsap, ScrollTrigger, SplitText, ScrambleText, ScrollSmoother, CustomEase, draco, ktx2, splat |
| Hebbia | 852 | 852 (h2) | 1235 | 1497 | 31,107 | 61, 0 | 262,690 | three r185, framerMotion |
| Composio | 804 | 804 (span) | 1379 | 1343 | 1,781 | 182, 180 | 9,508 | three r183, r3f |
| Krea | 1196 | 1308 (img) | 3076 | 3426 | 43,062 | 60, 0 | 10,974 | three r172, gsap, ScrollTrigger, SplitText, ScrollSmoother |
| Shopify Editions | 1044 | 1044 (h1) | 1391 | 573 | 2,228 | 180, 120 | 144 | three r181, r3f, draco, ktx2 |
| basement.studio | 344 | 344 (h1) | 607 | 2419 | 20,359 | 180, 180 | 2,617 | three r180, r3f, draco, ktx2 |
| Active Theory | 612 | 696 (div) | 183 | 513 | 9,256 | 60, 60 | 24 | own WebGL engine, CustomEase, theatre.js, draco |
| Abstract Intelligence | 536 | 536 (span) | 694 | 221 | 1,872 | 137, 124 | 10,975 | gsap, ScrollTrigger, ScrambleText, ScrollSmoother, CustomEase, lenis, draco, ktx2 |
| Unicorn Studio | 760 | 760 (h1) | 606 | 846 | 11,857 | 61, 61 | 144 | Unicorn Studio runtime |
| TwelveLabs | 748 | 748 (h1) | 1644 | 2184 | 55,653 | 174, 120 | 5,655 | three r136, lottie, framerMotion, howler |
| Lovable | 720 | 720 (h2) | 2730 | 2186 | 3,636 | 0, 0 | 3,672 | WebGL gradient drawn once, framerMotion |

### 3.3 Probed and not selected (41)

First-pass numbers (FCP / LCP in ms, JS in KB). Most of the named AI companies now run editorial or video sites, not realtime 3D.

| Site | FCP / LCP | JS | Why not |
|---|---|---|---|
| Poolside, poolside.ai | 484 / 1916 | 672 | Light editorial layout with a terminal hero. three.js only for small line drawings. |
| Periodic Labs, periodic.com | 228 / 228 | 325 | Text page on Framer, no WebGL. |
| Reflection, reflection.ai | 1264 / 1264 | 350 | Centred serif text behind a consent wall. |
| Cognition, cognition.ai | 460 / 460 | 1714 | Editorial. Loads Unicorn Studio and Lottie for small effects. |
| Exa, exa.ai | 668 / 668 | 1311 | DOM tile collage around a search demo. |
| Factory, factory.ai | 816 / 1828 | 1134 | Mono and pixel type (Geist Pixel), a curl install line. three.js bundled but no context in the hero. |
| Linear, linear.app | 1544 / 2956 | 1360 | Product UI hero, no WebGL. |
| Cartesia, cartesia.ai | 700 / 700 | 1502 | Light touch: small WebGL voice orbs. |
| Luma, lumalabs.ai | 668 / 668 | 1724 | Image collage and video. |
| Runway, runwayml.com | 940 / 1388 | 2806 | Video, 57 MB in 10 s. |
| Clay, clay.com | 3460 / 3460 | 2984 | 3D clay scene is video and images. FCP 3.5 s. |
| Vercel, vercel.com | 2108 / 2396 | 1267 | Prism graphic without WebGL. |
| Rive, rive.app | 652 / 1268 | 884 | Rive runtime demos. |
| Minitap, minitap.ai | 680 / 680 | 1659 | Listed on Awwwards as an "AI 3D WebGL website", but the current site has no WebGL. |
| Sierra, sierra.ai | 764 / 1100 | 2014 | Video hero with floating chat cards. |
| Decagon, decagon.ai | 4128 / 4128 | 1920 | Illustrated parallax. FCP 4.1 s. |
| Harvey, harvey.ai | 1676 / 1768 | 1761 | Serif and product UI. |
| Physical Intelligence, pi.website | 504 / 504 | 449 | Text. |
| Thinking Machines, thinkingmachines.ai | 596 / 640 | 18 | Text (18 KB of JS; a good reminder of the floor). |
| Granola, granola.ai | 592 / 680 | 1169 | Illustration and GSAP. |
| Cursor, cursor.com | 1016 / 1016 | 3322 | Product screenshots on painted backgrounds. |
| Mistral, mistral.ai | 612 / 2944 | 904 | Pixel-art hero (three r184) behind a cookie wall. |
| ElevenLabs, elevenlabs.io | 912 / 912 | 2252 | WebGL orb carousel. |
| Etched, etched.com | 1108 / 2028 | 358 | Photography. |
| Figure, figure.ai | 248 / 520 | 729 | Video. |
| Paper, paper.design | 608 / 9200 | 572 | Shader demos. LCP 9.2 s. |
| Basis, getbasis.ai | 1932 / 2120 | 1361 | Video, 38 MB in 10 s. |
| Anduril, anduril.com | 764 / 996 | 630 | Video and splats. |
| Warp, warp.dev | 768 / 768 | 1982 | Product UI. |
| Sesame, sesame.com | 508 / 508 | 665 | Text. |
| Artificial Societies, societies.ai | 960 / 984 | 422 | Illustration. |
| artificial-garage.com | 1136 / 1196 | 130 | GSAP page transitions, no WebGL. |
| TRN, trn.eu | 1096 / 1096 | 392 | Webflow, never finished loading. |
| Liquid AI, liquid.ai | 1136 / 1136 | 1242 | Imagery. |
| Lightmatter, lightmatter.co | 1760 / 1760 | 1037 | Video hero. three.js bundled, no context. |
| Odyssey, odyssey.systems | 424 / 2192 | 938 | Video, 95 MB in 10 s. |
| 1X, 1x.tech | 512 / 636 | 2564 | Video and imagery. |
| Decart, decart.ai | 1600 / 1600 | 763 | Video. |
| Sakana AI, sakana.ai | 912 / 912 | 378 | Illustration. |
| Normal Computing, normalcomputing.com | 1004 / 1004 | 447 | Webflow and video. |
| Hume, hume.ai | 1056 / 2108 | 2676 | Gradient orbs. |

(spur.us returned HTTP 429 and was not probed.)

---

## 4. Patterns across the set

Counts are over the 19 selected sites unless Solais is named.

- **Renderer.** three.js in 15 of 19 (revisions r136 to r185), wrapped in React Three Fiber on 6 (Extropic, Raycast, World Labs, Composio, Shopify Editions, basement). The Spline runtime on 2 (Resend, Spline). Own engines on 2 (Active Theory, Unicorn Studio). Lovable draws its gradient once without three.js.
- **Motion library.** GSAP on 6 (Igloo, Oryzo, Modal, World Labs, Krea, Abstract Intelligence) plus Solais. ScrambleText on World Labs and Abstract Intelligence plus Solais. Lenis on Extropic and Abstract Intelligence plus Solais.
- **Weight.** Median JS 1,250 KB, ranging from 221 KB (Abstract Intelligence) to 3,426 KB (Krea). Median transfer in 10 s is 13 MB, driven by video and splats.
- **Speed on a fast machine.** Median FCP 680 ms, median LCP 804 ms. Where text is the LCP element, these sites are fast. LCP over 1.5 s: Extropic (7.5 s, a late-animated paragraph), Oryzo (3.7 s, an image), Modal (1.6 s), and Solais (4.7 s).
- **First WebGL context** from 183 ms (Active Theory) to 3,076 ms (Krea). Solais is last at 3,503 ms.
- **Environment maps shipped as files**: Solais 1,390 KB EXR, Modal 1,608 KB HDR, Lusion 589 KB EXR matcap. The proof shows a procedural environment gets close for 0 bytes (§7.3.3).
- **Reduced motion.** Loops that stop: Hebbia, Krea. Drawn once anyway: Lovable. Slower but still running: Extropic, World Labs, Shopify Editions, TwelveLabs. Unchanged or nearly: the other 12, and Solais. Fourteen bundles contain the string `prefers-reduced-motion`, mostly inside libraries, so its presence says little about behaviour.
- **Render loops.** Spline runs 420 callbacks a second, Solais 305, Extropic 300. Lovable runs 0. One loop at 60 is the most anyone needs.
- **Without JS.** Empty or nearly (under 200 characters): Igloo, Active Theory, Shopify Editions, Unicorn Studio. Text in the HTML but a loader or blank screen on top: Solais ("Loading..."), Oryzo (solid green), Lusion ("000"), basement (black under the nav). A proper poster: Extropic (`scratchpad/p3d/final/nojs-sheet.jpg`).
- **Accessibility basics.** Skip links on 3 of 19 (Hebbia, Shopify Editions, Lovable) plus Solais. Igloo's page has 4 elements in `body`, 0 characters of text, 0 links and 0 buttons.
- **Sound.** Toggles on 5: Igloo, Lusion, basement, Active Theory, Shopify Editions. All start muted.
- **OG images** range from 13 KB (Solais, 1200x675 PNG) to 3.3 MB (basement, an animated GIF) and 3.0 MB (Raycast, a 2400x1260 PNG). Composio and Krea ship none.
- **Cursor.** None of the 19 replaced the system cursor (`cursor: none`) in this run, and no pointer-following element was detected. Custom cursors have gone out of fashion on these sites.

---

## 5. Feature catalogue

For every feature: where it was seen, what it adds, how to build it in this stack (plain HTML, CSS and TS with Vite; three.js only through a lazy import; GSAP allowed; no React), its cost, and a verdict. Costs are gzip. "Motion off" means `prefers-reduced-motion: reduce` or the site's own Motion toggle (§7.6).

Verdicts: **Build** (in the first release), **Adapt** (a changed version), **Later**, **Skip**.

### 5.1 3D centrepiece and camera

| Feature | Seen on | What it adds | Recipe here | Cost | Verdict |
|---|---|---|---|---|---|
| Extruded 3D mark with bevel and scratched metal | Solais, Resend (cube), Active Theory (glass logo), Modal (cube) | One ownable object that carries the brand and catches light | The Street: `ExtrudeGeometry` from the six gable profiles, bevel 0.03, depth 0.42, `MeshPhysicalMaterial` with a canvas-drawn scratch map for roughness and bump, clearcoat 1 (§7.3). Built procedurally, so no glb or Draco. | In the 143 KB three chunk. 0 bytes of assets. | Build |
| 3D object reacting to the cursor | Solais, Lusion, Igloo, Spline, Active Theory | Makes the page feel alive at no reading cost | Camera yaw ±3° and pitch ±1.5° around the look target, damped with `1 - exp(-5 * dt)`. `pointer: fine` only. The Street never moves under the text. | Under 0.3 KB | Build |
| Scroll-scrubbed camera path | Solais, Igloo, Oryzo, Shopify | Story without a video; the object explains the product section by section | Nine camera keyframes (§7.5). One ScrollTrigger per section tweens a `cam` object with `scrub: 0.8`. Position runs along a `CatmullRomCurve3` and the target is lerped. Render on demand. | Needs ScrollTrigger (§6) | Build |
| Pinned scroll story | Solais (one 1550% pin), Oryzo, Igloo (virtual scroll) | Holds the object in frame while text changes | No pinning. The canvas is `position: fixed` behind transparent "stage" sections, and content scrolls normally. The How-it-works steps use CSS `position: sticky` (0 KB). | 0 KB | Adapt |
| One object carried through every section | Oryzo, Solais | Continuity: the page reads as one scene | The Street stays in the fixed canvas from hero to footer. Only camera, lighting and window states change. | Included | Build |
| Highlight plus callout lines from 3D to text boxes | Solais (OutlinePass plus `Line2`), Igloo | Connects the abstract object to concrete facts | Highlight: an emissive frame quad around the target window (no full-screen outline pass). Line: an SVG overlay `<line>` from the window's projected point to the card edge, plus a DOM diamond marker. Updated only when the camera moves. Precomputed for the posters. | Under 1 KB. Saves an OutlinePass and a fat-line shader. | Build |
| Floating data labels | Solais (binary and coordinates), Igloo ("TEMP 55.32") | Technical texture; says "data" without a chart | DOM spans anchored to 3D points: postcode fragments (`3512XK_02`), rents (`€1.180 / 42m²`), ids (`0142_found`). Far ones get `filter: blur(1px)`. `aria-hidden`. Scrambled in once, then still. | Under 0.5 KB | Build |
| Perspective grid floor | Solais, Spline | Places the object in a space; a blueprint feel | The Solais-style shader rewritten: anti-aliased `fwidth` lines, plus markers every 2 cells, radial fade (in the proof). Poster mode uses the rendered still. | About 40 lines of GLSL | Build |
| Particles and glowing motes | Solais, Igloo, Modal, Krea, Active Theory | Depth and atmosphere | 260 `Points` with size attenuation and additive blending, seeded so posters match. Motion is a slow upward drift. Listing events send one mote along a curve into a window, which then lights (§7.3.6). | About 1 KB | Build |
| Cursor physics and displacement | Lusion | Playful | None. It fights the calm, informational tone. | | Skip |
| HDR or EXR environment file | Solais (1.39 MB), Modal (1.61 MB), Lusion (589 KB) | Believable reflections | A procedural "dusk" environment: a dim box plus four emissive panels (warm street light low left, cool sky high right, paper fill front right, warm bounce low) through `PMREMGenerator.fromScene`. Both themes. | 0 bytes, about 20 to 60 ms of GPU at init | Adapt |
| Gaussian splats | World Labs, Oryzo, Anduril | Photoreal captured scenes | Megabytes per scene, off-brand. | 1.4 MB per scene measured | Skip |
| Glass and transmission | Modal, Active Theory | Luxury | An extra render of the scene per frame. The white window frames already give contrast. | | Skip |
| WebGPU or TSL renderer | Bundled by Igloo, Raycast, basement | Future-proofing | WebGL2 covers every target browser. Revisit when three's WebGPU build is smaller. | | Later |

### 5.2 Surface and texture

| Feature | Seen on | What it adds | Recipe here | Cost | Verdict |
|---|---|---|---|---|---|
| Film grain | Solais, Extropic (grain in shaders), Composio | Analogue warmth, hides gradient banding | The base brief's 160px SVG `feTurbulence` tile over the hero and stage sections, `mix-blend-mode: multiply` at 0.26 in light and `overlay` at 0.16 in dark. Optional movement: an oversized grain layer translated in `steps(4)` every 0.5 s (compositor only). Still when motion is off. | 0.4 KB inline | Build |
| Bold warm-to-paper bleed | Solais (crimson to white) | The signature colour move | Five stacked radial gradients from `--ember-deep` through `--ember`, `--brick` and `--oranje` to paper (§7.2). Dark theme: a low ember glow on canal black with a cool sky corner. Verified in the proof. | 0 KB | Build |
| Noise-animated gradient backgrounds | Solais (noise-warped sine bands), Lovable, Raycast, Unicorn | Movement in the colour itself | Optional: port Solais's band shader into a full-screen triangle behind the Street, running only in the hero while visible. The static CSS bleed is the default. | About 1 KB of GLSL; one full-screen pass | Later |
| Dithered images | Extropic textures, Unicorn Studio | Technical, print-like texture | Build time: a 1-bit ordered (Bayer 8x8) version of the Action inbox screenshot, about 15 KB PNG, crossfading to the real AVIF when the section reveals. No runtime shader. | About 15 KB per image | Later |
| ASCII rendering | Active Theory (glyph fields), Factory (pixel type) | Hacker texture that fits the terminal section | `npx nl-property-finder status` in the terminal demo prints a small ASCII facade whose lit windows, drawn as full-block characters, are today's matches. Text, 0 KB, with an `aria-label` summary. | 0 KB | Build |
| Bloom and glow | Modal, Composio, Igloo | Light that feels emitted | Additive halo points behind lit windows (in the proof) instead of an `UnrealBloomPass`. | Saves 4 to 5 extra passes a frame | Adapt |
| Blueprint grid overlays and crosshair corners | Extropic, Oryzo, Lusion, Solais (plus markers) | Engineering precision; frames content | CSS: plus marks at section corners from two `linear-gradient`s on pseudo-elements; a dotted rule between sections (base brief). Oryzo-style dimension ticks on the callout bracket. | 0.3 KB | Build |
| Chromatic aberration | Igloo, Composio | Lens realism | Costs a pass and hurts legibility near text. | | Skip |

### 5.3 Type and text

| Feature | Seen on | What it adds | Recipe here | Cost | Verdict |
|---|---|---|---|---|---|
| Uppercase mono typography | Solais, Composio, Rive, Factory, Extropic | Technical, instrument-like voice | JetBrains Mono (already in the system) in uppercase for nav, chips, h2, callout titles and labels, via `text-transform` only; source text stays sentence case so screen readers do not spell words out. Body stays Instrument Sans. | 30 KB font, already budgeted | Build |
| Slash-separated nav | Solais | Reads as a path; compact | `HOW IT WORKS / INBOX / CLAUDE / PRIVACY / COST`. The slashes are `aria-hidden` spans between real links. | 0 KB | Build |
| Label chips with bars | Solais ("ANALYTICS FOR" followed by two bars) | Tags a heading like a spec sheet | Paper chip with ember-deep mono text, then two 4px paper bars (decorative) (§7.2). | 0 KB | Build |
| Two-line headline with an indent rule | Solais | Rhythm; the eye steps down | The second line starts with a 118px rule that fades in from transparent. The rule is `aria-hidden`. | 0 KB | Build |
| Mixed display (mono or display capitals plus thin serif) | Extropic, Abstract Intelligence | Contrast inside one headline | "RENTING IN / THE *Netherlands*": JetBrains Mono 500 uppercase plus one Instrument Serif italic word per headline. | 21 KB (the serif italic) | Build |
| Text scramble and decode | Solais (endless), Active Theory, Oryzo, World Labs | Signals "machine output" | GSAP ScrambleText, once per element on first reveal, 0.6 to 0.9 s, `chars: "01_/·"`, only on short mono strings (chips, callout titles, data labels). Never the h1, never body text, never looping. The visible copy is `aria-hidden`; a real text copy sits beside it for assistive tech (§7.3.8). | 3.9 KB on top of core | Build |
| Split-text line reveals | Lusion (203 split spans), Hebbia, Solais | Headlines arrive with intent | SplitText on h2 only, `type: "lines", mask: "lines"`, lines rise 100% to 0 over 0.7 s with `--ease-out`. SplitText 3.15 sets `aria-label` on the element and `aria-hidden` on the pieces by default (`aria: "auto"`, checked in the package). | 3.6 KB | Build |
| Giant sliding type | Oryzo ("it's wearable"), Extropic (marquee headline) | A scale jump that marks a chapter | Footer only: a viewport-wide `NL-PROPERTY-FINDER` in JetBrains Mono that slides 12% with scroll. CSS `animation-timeline: view()` where supported, otherwise static. | 0.2 KB | Build |
| Live counters and tickers | Lusion (percent preloader), Solais (loader digits) | Numbers feel live | The pipeline strip (checks, matches, messages) counts up once in view over 0.8 s, `tabular-nums`. Labelled as sample numbers. No preloader counter, because there is no preloader. | 0.3 KB | Build |
| Terminal typing | Poolside (hero terminal), Factory, Rive (CLI) | Shows exactly how it is used | Section 6: a transcript typed at 18 ms per character, tool-call chips scrambled in. The full transcript is in the DOM from the start and revealed with a `clip-path` wipe per line, so screen readers get all of it at once. | 0.6 KB | Build |

### 5.4 Interaction

| Feature | Seen on | What it adds | Recipe here | Cost | Verdict |
|---|---|---|---|---|---|
| Click to explore / hotspots | World Labs ("Click to explore"), Igloo ("CLICK TO EXPLORE") | Invites play | Callout cards are real `<button>`s in DOM order. Focusing or hovering one moves the camera to frame its window and lights the highlight frame. The canvas itself is never a focus target. | 1 KB | Build |
| Custom cursor with label | none in this run | | Replaced by a coordinate readout: over the canvas only, with `pointer: fine`, a small mono label follows the pointer (`x 0.42  y 1.38`, or the address when over a window). The system cursor stays. | 0.4 KB | Adapt |
| Magnetic buttons | common on studio sites | Tactile | Primary button only, `pointer: fine`, at most 4px of pull through `gsap.quickTo`. Off when motion is off. | 0.2 KB | Build |
| Hover-tilt cards | Abstract Intelligence (tilted frames) | Depth on cards | Vestibular risk and little information. Cards lift 1px on hover as in the base brief. | | Skip |
| Sound toggle | Igloo, Lusion, basement, Active Theory, Shopify | Craft signal | "Sound: off" in the footer, off by default, remembered in `nlpf-sound`. When on: a soft WebAudio blip (sine 880 to 660 Hz over 60 ms, gain 0.04) when a window lights, a lower one for "needs you". Synthesized, no audio files. | Under 1 KB | Later |
| Theme transition | none in the set | A moment competitors do not have | View Transitions API: a circular reveal from the toggle button (`document.startViewTransition`). Meanwhile the Street lerps from dusk to night over 600 ms: the key light dims, the environment cools, windows brighten. Where view transitions are missing, the switch is instant. | 0.5 KB | Build |
| Clipped-corner buttons | Solais | Industrial detail | The clip is drawn on a `::before` background layer, never on the element itself, so the focus outline is not clipped (§7.2). | 0 KB | Build |
| Blinking status square | Solais callouts, Raycast UI | "Live" signal | A 12px bordered square with a 6px inner square blinking at 1 Hz (`steps(2)`). Blinking stops when motion is off; the square stays filled. | 0 KB | Build |

### 5.5 Layout and scroll

| Feature | Seen on | What it adds | Recipe here | Cost | Verdict |
|---|---|---|---|---|---|
| Smooth scroll library | Solais (Lenis and ScrollSmoother together), Extropic, Abstract Intelligence; virtual scroll on Igloo and Lusion | Glide | Native scroll plus a short camera lag (`scrub: 0.8`) gives the glide where it shows, on the 3D. Lenis 1.3 (5.4 KB) is an option that stays off by default, and if ever enabled then only for `pointer: fine` with motion on, `syncTouch: false`, `anchors: true`. Never ScrollSmoother, which wraps the page in a transformed container. | 0 KB, or 5.4 KB | Adapt |
| Sticky storytelling | Solais (pin), Hebbia (38 sticky elements) | One visual while text steps through | How it works: a sticky left column with the four steps, a scrolling right column; the active step tracked by ScrollTrigger progress. Pure CSS sticky underneath, so it works without JS. | 0 KB | Build |
| Horizontal scroll gallery | Oryzo, Extropic | Variety | Scroll-jacked horizontal galleries break keyboard and trackpad expectations. The giant footer type covers the moment. | | Skip |
| Marquee band | Hebbia, Modal, Unicorn | Shows breadth | Sources band, per the base brief: a marquee only at six or more sources, otherwise a static row. Text names only, never logos. | 0 KB | Build |
| Bento grid | Hebbia, Modal | Dense overview | Privacy as a 2x2 bento on desktop (the base brief's four `dl.points`), a single column on mobile. | 0 KB | Build |
| Page-load intro | Solais (loader and mosaic), Lusion (counter), Igloo (assembly) | Ceremony | No loader. Once the Street is ready, and only if the hero is still in view with no scroll yet: windows light one by one (8 over 1.6 s), the chip scrambles, the callout line draws from window to card. The text is visible throughout. | 0.5 KB | Adapt |
| Section progress indicator | Oryzo (vertical progress bar) | Orientation on a long page | A right-edge rail on desktop: `03 / 09  HOW IT WORKS` in mono, current section via IntersectionObserver, `aria-current="true"` on the matching nav link. | 0.4 KB | Build |
| View transitions | Solais's CSS contains view-transition rules | Smooth state changes | Used for the theme switch only. | 0 KB | Build |

### 5.6 Product demos

| Feature | Seen on | What it adds | Recipe here | Cost | Verdict |
|---|---|---|---|---|---|
| Interactive demo in the hero | Krea, Spline, Lovable (prompt fields) | Instant understanding | The hero callout plus the live feed simulation: sample events every 0.9 to 1.3 s, each "found" event lighting a window. A "Replay" text button. The DOM feed runs even when the 3D does not. | 1 KB | Build |
| Keyboard product demo | none | Proves the inbox flow | Section 5: three sample inbox items. J and K move, A accepts, E opens the draft, X dismisses. Results are announced in a polite live region; "Reset demo" restores it. | 1.2 KB | Build |
| Terminal demo | Poolside, Factory, Rive | Shows the MCP use honestly | Section 6, see 5.3. | 0.6 KB | Build |

### 5.7 Meta

| Feature | Seen on | What it adds | Recipe here | Cost | Verdict |
|---|---|---|---|---|---|
| OG image | 13 KB (Solais) to 3.3 MB (basement) | Link previews carry the brand | 1200x630 JPEG at quality 82 rendered from the Street at night (the dark poster), with the chip and h1 set in the site fonts. Target 150 KB or less. `twitter:card` `summary_large_image`. | 0 on page | Build |
| Skip link, real headings, text as text | 3 of 19 have skip links; Igloo has no DOM text | Baseline access | The base brief's rules apply unchanged. The Street is decoration; everything it shows is also said in text. | 0 KB | Build |

---

## 6. GSAP licence, checked

- npm `gsap` 3.15.0 (installed 2026-09-23) declares `"license": "Standard 'no charge' license: https://gsap.com/standard-license."`. SplitText, ScrambleTextPlugin, DrawSVGPlugin, MorphSVGPlugin, ScrollSmoother, Flip and InertiaPlugin all ship in the public package. No token or private registry is needed.
- gsap.com/standard-license: commercial use is covered at no charge, including the formerly members-only plugins. The restriction is on "Prohibited Uses": tools that let users build visual animations without code in a way that competes with Webflow's visual animation builder. Proprietary notices must not be removed, and GSAP must not be reverse engineered into a competing product. A marketing site for an MIT-licensed agent is well outside the restriction.
- GSAP is not MIT. Depend on it through npm (not vendored into the repo), and name it with its licence link in the footer credits and in `THIRD_PARTY_NOTICES.md`.
- The change dates from GSAP 3.13 in April 2025, after Webflow acquired GreenSock in October 2024.
- Measured sizes (esbuild, minified, gzip -9):

| Bundle | Minified | Gzip |
|---|---|---|
| gsap core | 70.1 KB | 27.7 KB |
| core plus ScrollTrigger | 114.0 KB | 45.2 KB |
| core plus ScrollTrigger, SplitText, ScrambleText, DrawSVG | 136.7 KB | 53.4 KB |
| SplitText alone | 7.5 KB | 3.6 KB |
| ScrambleTextPlugin alone | 11.5 KB | 3.9 KB |
| Lenis 1.3.26 | 18.4 KB | 5.4 KB |
| OGL 1.0.11, full-screen shader only | 44.0 KB | 12.7 KB |
| three r186, the proof scene (named imports) | 569 KB | 143 KB |
| the same plus GLTFLoader and DRACOLoader | 642 KB | 165 KB |
| the same plus EffectComposer, UnrealBloom and OutputPass | 584 KB | 148 KB |

three.js is barely tree-shakable once `WebGLRenderer` is imported: the renderer pulls in all shader chunks. The choice is three at about 143 KB for a physical material that works, or OGL at about 13 KB plus a hand-written PBR shader. This brief takes three, loaded after LCP, because the scratched-metal look depends on its physical material and PMREM, and a lazy chunk does not touch LCP.

---

## 7. The upgraded site

### 7.1 Rules that make it beat the references

1. **Text first.** All copy is in the HTML. The h1 is never hidden, split or faded in, so it can be the LCP element. (Extropic's LCP was 7.5 s because its LCP paragraph animates in late.)
2. **No loader, no gate.** The page is complete at first paint. The Street is an enhancement that crossfades in over an identical poster.
3. **One loop, on demand.** One requestAnimationFrame loop that runs only while something moves. It stops when idle, when the canvas is covered or off screen, when the tab is hidden, and when motion is off. Target: 60 callbacks a second while animating, 0 at rest.
4. **Motion respects the reader.** `prefers-reduced-motion` and a visible Motion toggle switch to stills. No looping scramble, no endless blink, no cursor effects.
5. **Keyboard parity.** Anything the 3D reveals can also be reached by Tab, and focusing it drives the 3D.
6. **Budget in CI.** Size and Lighthouse checks fail the build (§7.7).

### 7.2 Visual grammar: tokens and CSS added to Canal Light

New tokens in `tokens.css` (light values, then dark overrides; declared twice as in the base brief):

```css
:root {
  --ember: #9A3417;        /* paper text on it: 6.52:1 */
  --ember-deep: #3A1409;   /* paper text on it: 14.62:1 */
  --bleed:
    radial-gradient(52% 80% at 6% 88%, var(--ember-deep) 0%, rgb(58 20 9 / 0) 72%),
    radial-gradient(58% 95% at 16% 62%, var(--ember) 0%, rgb(154 52 23 / 0) 74%),
    radial-gradient(46% 90% at 34% 38%, rgb(224 88 47 / .92) 0%, rgb(224 88 47 / 0) 70%),
    radial-gradient(40% 70% at 47% 78%, rgb(255 154 77 / .75) 0%, rgb(255 154 77 / 0) 70%),
    radial-gradient(34% 56% at 56% 16%, rgb(255 217 168 / .65) 0%, rgb(255 217 168 / 0) 70%);
  --on-bleed: #F5F2EA;
  --grain-opacity: .26;    /* stronger than the base brief's .22, closer to Solais */
}
:root[data-theme='dark'] {
  --bleed:
    radial-gradient(55% 70% at 4% 96%, rgb(154 52 23 / .95) 0%, rgb(154 52 23 / 0) 72%),
    radial-gradient(45% 60% at 26% 88%, rgb(255 122 51 / .55) 0%, rgb(255 122 51 / 0) 70%),
    radial-gradient(40% 50% at 44% 96%, rgb(255 178 107 / .22) 0%, rgb(255 178 107 / 0) 70%),
    radial-gradient(70% 70% at 96% 0%, rgb(58 96 122 / .6) 0%, rgb(58 96 122 / 0) 70%);
  --on-bleed: #ECF1EE;     /* 6.39:1 on --ember */
  --grain-opacity: .16;
}
```

Contrast rule for the bleed: paper on `--brick` is only 3.35:1, so text in `--on-bleed` sits only where the bleed is `--ember` or darker (bottom left). At 76px the h1 would pass 3:1 anyway, and keeping it on ember gives 6.5:1. The lede, labels and callouts sit on the paper side in `--text`.

Type roles (fonts measured as latin woff2 from Google Fonts):

| Role | Face | Setting | File |
|---|---|---|---|
| h1 lines | JetBrains Mono 500, uppercase | 76px desktop, `clamp(2.6rem, 1.2rem + 5vw, 4.75rem)`, lh .98, ls -.045em | 30.7 KB (400 to 600) |
| h1 accent word | Instrument Serif italic | 1.26x the mono size, ls -.02em | 21.6 KB |
| h2 | JetBrains Mono 500, uppercase | `clamp(2rem, 1.3rem + 2.6vw, 3.5rem)`, lh 1.0, ls -.035em, at most 2 lines of 18 characters | same file |
| Chips, nav, labels, callout titles | JetBrains Mono 500, uppercase | 12 to 15px, ls .02 to .06em | same file |
| Lede | JetBrains Mono 400 | 14.5px/1.62, at most 5 lines | same file |
| Body | Instrument Sans, wght axis only | 17px/1.6 | 29.4 KB (55 KB with the wdth axis; drop wdth) |

Instrument Serif regular (20.5 KB) leaves the site unless a pull quote needs it. Total: 81.7 KB, against 132 KB in the base brief.

Components (all verified in the proof page, `docs/design/proto3d/index.html`):

```css
/* Slash nav: the slashes are decoration, the links are the list. */
.links { display: flex; align-items: center; gap: 14px; font: 500 13px/1 var(--font-mono);
  text-transform: uppercase; letter-spacing: .04em; }
.links .sep { opacity: .55; }                                  /* <span class="sep" aria-hidden="true">/</span> */

/* Label chip with two bars. */
.chip { display: inline-flex; align-items: stretch; gap: 4px; }
.chip span { background: var(--bg); color: var(--ember-deep); font: 500 15px/1 var(--font-mono);
  text-transform: uppercase; letter-spacing: .02em; padding: 7px 12px 6px; }
.chip i { width: 4px; background: var(--bg); }                 /* two <i aria-hidden="true"> */

/* Two-line headline with an indent rule. */
h1 .l2 { display: flex; align-items: baseline; gap: 22px; }
h1 .rule { width: 118px; height: 3px; align-self: center;
  background: linear-gradient(90deg, rgb(245 242 234 / 0), var(--on-bleed)); }

/* Clipped-corner primary button. The clip sits on a pseudo-element so the
   focus outline on the element itself is never clipped. */
.btn-cut { position: relative; isolation: isolate; display: inline-flex; align-items: center;
  min-height: 48px; padding: 0 22px; color: var(--bg); font: 600 13px/1 var(--font-mono);
  text-transform: uppercase; letter-spacing: .06em; text-decoration: none; }
.btn-cut::before { content: ""; position: absolute; inset: 0; z-index: -1; background: var(--text);
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px)); }
.btn-cut:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }

/* Bracketed callout with a blinking status square. */
.callout { position: absolute; padding: 4px 0 4px 18px; font: 400 13px/1.55 var(--font-mono); }
.callout::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 8px;
  border: 1.5px solid currentColor; border-right: 0; }
.callout .sq { width: 12px; height: 12px; border: 1.5px solid currentColor; display: grid; place-items: center; }
.callout .sq::after { content: ""; width: 6px; height: 6px; background: var(--st-contacted);
  animation: blink 1s steps(1, end) infinite; }
@keyframes blink { 50% { opacity: 0; } }
:root.motion-off .callout .sq::after { animation: none; }

/* Crosshair corners on a stage section. */
.corners { position: relative; }
.corners::before { content: ""; position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(var(--line-strong), var(--line-strong)) 0 0 / 13px 1px no-repeat,
    linear-gradient(var(--line-strong), var(--line-strong)) 6px -6px / 1px 13px no-repeat,
    linear-gradient(var(--line-strong), var(--line-strong)) 100% 0 / 13px 1px no-repeat,
    linear-gradient(var(--line-strong), var(--line-strong)) calc(100% - 6px) -6px / 1px 13px no-repeat; }
```

### 7.3 The centrepiece: the Street

Proof: `refs/99-proof-3d-light.webp` and `refs/99-proof-3d-dark.webp`, rendered by `docs/design/proto3d/scene.js` on three r186. Numbers: 13 draw calls, 4,420 triangles, 60 windows (14 lit), first frame 80 to 190 ms after the module ran, 143 KB gzip bundle.

#### 7.3.1 Geometry

- Six houses left to right: trapgevel (step, 1.00 wide), halsgevel (neck, 0.90), klokgevel (bell, 0.95, quadratic shoulders plus an arc), tuitgevel (spout, 0.85), lijstgevel (cornice, 1.10, the cornice overhangs 0.05), and a wide trapgevel (1.15). Profiles are `Shape`s built from half-outlines mirrored about the centre line (the proof's `mirror()` helper), in units of about one house width. Heights run 2.18 to 2.74.
- `ExtrudeGeometry` with depth 0.42, bevel thickness 0.035, bevel size 0.03, 5 bevel segments, 20 curve segments. The bevel is what catches the warm highlights; with a 0.012 bevel the fronts read as flat black (tested). The 0.42 depth makes the row read as an extruded logotype like Solais's mark; a 1.5 depth made it a box (tested).
- The row sits on the grid at y = 0, rotated 0.5 rad about y so the extrusion shows.
- Windows per house: three floors of 2 or 3 columns (3 when a house is wider than 1.0), a door, a wide ground window and a gable window. They are instanced: one `InstancedMesh` of thin boxes for the white frames (`#EDE6D6`, the paper tint real canal houses have), one of planes for dark glass, one of planes for lit glass. Put panes at z = 0.068, in front of the bevelled face at 0.035, with `polygonOffset` on the pane material (the proof shows z-fighting stripes on three panes without it).
- The seventh house (section 8) is the same builder, animated from `scale.z = 0.001` to 1.

#### 7.3.2 Materials

```ts
// Scratches: a 512px canvas of 900 seeded strokes, used as roughness and bump map.
// Seeded, so the rendered posters and the live scene match pixel for pixel.
const facade = new MeshPhysicalMaterial({
  color: dark ? 0x2E4845 : 0x34504C,  // ink-teal metal; reads near --gable at dusk
  metalness: 0.7, roughness: 0.34,
  roughnessMap: scratches, bumpMap: scratches, bumpScale: 5,
  clearcoat: 1.0, clearcoatRoughness: 0.12,
});
const litGlass = new MeshBasicMaterial({ color: new Color(dark ? 0xFFB066 : 0xFF9A4D).multiplyScalar(1.25), toneMapped: false });
const darkGlass = new MeshPhysicalMaterial({ color: 0x0B1414, roughness: 0.08, metalness: 0.2, clearcoat: 1 });
```

Tone mapping `ACESFilmicToneMapping`, exposure 1.05 (light) and 0.95 (dark), output `SRGBColorSpace`.

Next tuning step beyond the proof: a faint vertical ambient-occlusion gradient on the facade (darker at street level) and a brick-coursing normal map drawn on the same canvas, so the front faces pick up more than the bevels.

#### 7.3.3 Lighting and environment

- A procedural dusk environment through `PMREMGenerator.fromScene`: a back-faced box (`#2B2A27` light, `#060B0B` dark) and four emissive panels. Warm street glow (`--oranje` at x4 to x5) low front left, a warm strip (`--apricot` x2.2) above it, cool sky (`--sky`, or `#3A607A` at night) high back right, and a large paper fill (x3.0 light, x1.2 dark) front right. `scene.environmentIntensity` 1.0 (light) and 0.9 (dark).
- A warm key `DirectionalLight` (`#FFB26B`, 3.2 light, 3.0 dark) from front left, and a cool rim (`#A9C1D6` 2.2, or `#5E8FB0` 3.0 at night) from back right.
- Theme changes lerp these values over 600 ms (§5.4 theme transition).

#### 7.3.4 Glow, highlight, grid, labels

- Halos: one `Points` object with a vertex per lit window, additive, `gl_PointSize = 1100.0 * pixelRatio / -mv.z`, falloff `pow(1 - d, 2.2)`, strength 0.7 light and 0.8 dark. No bloom pass.
- Highlight: a plane 0.16 larger than the target window with a frame-only fragment shader (`smoothstep` on the max-norm distance), white at 0.95 alpha.
- Grid floor: a 40x40 plane, the shader from the proof (anti-aliased lines at 1.4 cells per unit, plus marks every 2 cells, radial fade 3 to 14 units), white at 0.55 alpha in light and `#9AB3B0` at 0.22 in dark.
- Labels: 4 to 6 DOM spans placed from projected 3D points, updated on camera change only.

#### 7.3.5 Callout lines (DOM, not WebGL)

```ts
// Called when the camera or the layout changes, never on idle frames.
function placeCallout(win: Vector3, card: HTMLElement, line: SVGLineElement, marker: HTMLElement) {
  const p = win.clone().applyMatrix4(street.matrixWorld).project(camera);
  const x = (p.x + 1) / 2 * view.w, y = (1 - p.y) / 2 * view.h;
  marker.style.transform = `translate(${x}px, ${y}px) rotate(45deg)`;
  const r = card.getBoundingClientRect();           // the card sits on the paper side
  line.setAttribute('x1', String(x)); line.setAttribute('y1', String(y));
  line.setAttribute('x2', String(r.left - 6)); line.setAttribute('y2', String(r.top + 10));
}
```

The SVG overlay needs `width: 100%; height: 100%` (the proof's first render lost the line without it). On first reveal the line draws from the window to the card with `stroke-dasharray`/`stroke-dashoffset` over 0.5 s. Without JS the same line comes from precomputed anchors (§7.3.10).

#### 7.3.6 Listings lighting windows

The DOM feed simulation (hero and section 2) emits events on a small event bus: `{ kind: 'found', window: 32, at: '21:04:17' }`. The Street, if loaded, answers:

1. A mote leaves the water line in front of the row and follows a quadratic curve (0.9 s, `--ease-out`) to the window.
2. The window pane switches from dark to lit with an emissive ramp over 400 ms, and its halo pulses once (scale 1.6 to 1, 1.2 s).
3. Labels near the window scramble in with the listing's postcode and rent.
4. For `needs-you` events the window blinks twice in `--st-needs-you` before settling lit.

With the Street absent or motion off, the DOM feed rows still appear (motion off shows the final list), and the poster's lit windows match the sample data.

#### 7.3.7 Camera and cursor

- Keyframes (world units; the row spans x from about -3 to 3.1, facade at z = 0, height up to 2.74):

| Key | Section | Camera position | Target | FOV | Scene state |
|---|---|---|---|---|---|
| K0 | Hero | (-6.2, 3.1, 14.2) | (0.55, 0.95, 0) | 22 | Dusk, 14 windows lit, callout on window 32 |
| K1 | Live feed | (-2.4, 1.9, 7.6) | (0.9, 1.3, 0) | 24 | Row left of centre; three callouts to the newest feed cards |
| K2 | How it works | (0.5, 9.5, 6.5) | (0.3, 0, 0.8) | 26 | High oblique view; the grid becomes the diagram; a glowing path marks watch, match, write, sort |
| K3 | Sources | (5.5, 2.2, 10.5) | (0.5, 1.1, 0) | 24 | Seen from the right; canvas under an opaque band, loop paused |
| K4 | Action inbox | (0.6, 1.7, 3.4) | (1.1, 1.55, 0) | 20 | Close on the needs-you window, still frame, canvas blurred 6px behind the panel |
| K5 | Claude and MCP | (-4.5, 1.4, 8.8) | (0.5, 1.2, 0) | 22 | Night lighting in both themes; windows pulse when the transcript calls `inbox_list` |
| K6 | Privacy | (-9, 6, 18) | (0, 1, 0) | 24 | Wide; a dashed box ("your computer") drawn around the street; outgoing requests leave to the left toward named sites; nothing goes right |
| K7 | Cost | none | none | none | Canvas faded out under a paper band, loop stopped |
| K8 | Contribute | (2.5, 2.0, 9) | (2.4, 1.3, 0) | 22 | A seventh house extrudes from the grid |
| K9 | Footer | (-6.8, 2.6, 15.5) | (0.4, 1.1, 0) | 22 | Night, every window lit, slow particle drift |

- One ScrollTrigger per stage section, `start: 'top bottom'`, `end: 'top top'`, `scrub: 0.8`, tweening a plain `cam` object between the neighbouring keys. The position is sampled along a `CatmullRomCurve3` through K0 to K9; the target and FOV are lerped. Every update sets `needsRender = true`.
- Cursor parallax: a yaw and pitch offset added after the scroll pose, damped, clamped to ±3° and ±1.5°, `pointer: fine` only.
- Resize: DPR `min(devicePixelRatio, 1.5)`, 1.25 on integrated GPUs whose renderer string contains "Intel" or "Mali", and a debounced `setSize`.

#### 7.3.8 Scramble without breaking screen readers

```html
<h3 class="callout-title">
  <span class="sr-only">Found 21:04:17</span>
  <span aria-hidden="true" data-scramble>Found 21:04:17</span>
</h3>
```

```ts
gsap.to(el, { duration: 0.8, ease: 'none',
  scrambleText: { text: el.textContent!, chars: '01_/·', revealDelay: 0.2, speed: 0.6 } });
```

It runs once per element, on first reveal, and only when motion is on.

#### 7.3.9 Lifecycle and gating

```ts
// main.ts (in the entry, about 1 KB of this logic)
const motionOff = () => document.documentElement.classList.contains('motion-off');
function stageCapable(): boolean {
  if (motionOff()) return false;
  if (matchMedia('(pointer: coarse)').matches && innerWidth < 900) return false;   // phones get stills
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }, deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if ((nav.deviceMemory ?? 8) < 4 || (navigator.hardwareConcurrency ?? 8) < 4) return false;
  const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
  if (!gl) return false;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return !/swiftshader|llvmpipe|software|basic render/i.test(name);
}

addEventListener('load', () => {
  const go = () => { if (stageCapable()) import('./stage/index.ts').then(m => m.start()); };
  'requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 1500 }) : setTimeout(go, 600);
});
```

Inside `stage/index.ts`:

- Build the scene, then `await renderer.compileAsync(scene, camera)` so shader compilation does not block the main thread. Render the first frame, then crossfade the poster to the canvas (opacity over 400 ms). The poster stays underneath until the fade ends.
- One loop: `renderer.setAnimationLoop(tick)` while `animating || needsRender`; `setAnimationLoop(null)` when idle. Idle means no tween running, no particles in view (particles run only in the hero and footer), and no pointer movement for 2 s.
- Pause: an IntersectionObserver on stage sections (paused when none is visible, for example during Sources and Cost), `visibilitychange`, and the Motion toggle.
- Watchdog: over each 60 frames, if the 90th-percentile frame time is above 20 ms, drop DPR to 1.0. If still above 24 ms, turn off particles and halos. If still above 28 ms, stop and fade back to the stills.
- `webglcontextlost`: fall back to the stills without an error message.

#### 7.3.10 Posters and stills (the no-3D path)

- `scripts/render-stills.ts` (Playwright) opens the built site with `?stills`. For each keyframe K0 to K9 (not K7), in both themes, it hides the DOM, renders the canvas with a transparent background, and saves PNG at 1440x900 and 2160x1350. `sharp` encodes AVIF (quality about 50) and WebP. It also writes `stills.json` with the projected anchor of each callout window per keyframe. The outputs are committed, so CI does not need a GPU (CI Chromium would fall back to SwiftShader).
- Measured on the proof, canvas layer only, transparent background: light 41 KB AVIF at 1440x900 and 84 KB at 2880x1800; dark 63 KB and 127 KB. WebP is about 50% larger. Budget: K0 at 1440w 65 KB or less, 2160w 100 KB or less.
- Hero markup: `<picture>` with AVIF and WebP sources, `srcset` 1440w and 2160w, `fetchpriority="high"`, `width`/`height` set, `alt=""` (the figure caption carries the meaning). The blocking head script preloads the poster for the stored theme (a `link rel=preload` it appends), so the theme override does not fetch the wrong poster.
- Section stills (K1 to K9) are lazy `<img>`s inside each stage section. A synchronous head check (motion setting, `saveData`, coarse pointer, width) adds `stage-likely` to `<html>`; CSS hides the stills then, and hidden lazy images are never fetched. If the WebGL gate later fails, `stage-likely` is removed and the stills load as the reader scrolls.
- Callouts without JS are positioned from `stills.json` with container units, so they line up with an `object-fit: cover` poster at any size:

```css
.stage { container-type: size; }
.stage .callout-anchor {
  --s: max(calc(100cqw / 1440), calc(100cqh / 900));   /* cover scale */
  left: calc(50cqw + (var(--ax) - 720) * var(--s));
  top:  calc(50cqh + (var(--ay) - 450) * var(--s));
}
```

### 7.4 Loading sequence (target on a mid laptop with Fast 4G)

| Time | Event |
|---|---|
| 0 | Navigation. GitHub Pages TTFB measured 52 to 187 ms from Amsterdam (8 requests to two Pages sites); allow 300 ms on a slower line. |
| about 400 ms | HTML (at most 18 KB gzip) parsed. The blocking head script sets theme, motion and `stage-likely`, and preloads the matching poster. Two fonts preloaded (JetBrains Mono, Instrument Serif italic). |
| 500 to 800 ms | FCP: nav, chip, h1, lede in metric-matched fallbacks or the real fonts. |
| 700 to 1,200 ms | LCP: the hero poster (full-bleed image, 65 KB or less) or the h1. Target under 1,500 ms at 4x CPU slowdown. |
| about 900 ms | `main.js` (10 KB or less) runs: nav state, the DOM feed simulation, IntersectionObserver reveals, the progress rail. |
| `load` plus idle | `motion.js` (GSAP core, ScrollTrigger, SplitText, ScrambleText: about 53 KB) and, if the gate passes, `stage.js` (about 155 KB: three plus about 12 KB of scene code). |
| about 1.8 to 2.8 s | First 3D frame, crossfade from the identical poster. The intro plays only if the reader has not scrolled. |

Nothing in this sequence moves layout: the poster box has an `aspect-ratio`, fonts have metric-matched fallbacks, and the canvas is fixed and decorative. CLS target under 0.02.

### 7.5 Section by section

"Stage" sections are transparent over the fixed canvas and carry their own still. "Band" sections are opaque and pause the loop. Every h2 is written in sentence case and uppercased by CSS; the rule before the second line is `aria-hidden`. The copy is sample copy under the owner's rules; check every claim against the shipped features before release.

**1. Hero (stage, K0).** Full-bleed `--bleed`. Nav top: mark and wordmark left in `--on-bleed`; slash nav, the Motion toggle, the theme toggle and a clipped "GitHub" button on the paper side in `--text`. Bottom left, on ember: the chip and the h1. Bottom right, on paper: the lede, two buttons and fine print. Centre: the Street, the callout card on the paper side with its line and diamond, and four data labels. Sample copy:

```
[chip] Local agent for
[h1]   Renting in / the Netherlands
[lede] It watches Dutch rental sites and writes to the landlord within a minute of a new listing that matches your search. Replies are sorted. The ones that need a person come to you. The agent is free and runs on your computer.
[buttons] Install    Read the source
[fine print] MIT licence. Node 20 or newer. No account, no server.
[callout] Found 21:04:17 / Oudegracht 112-B, Utrecht / €1.180 a month, 42 m², Pararius / Message sent 32 s later
[caption] Sample data. Addresses are made up.
```

The h1's accessible text is "Local agent for renting in the Netherlands" (the chip is inside the h1, as on Solais). "Within a minute" goes out only if the measured median send time supports it.

**2. Live feed (stage, K1).** Chip "Live feed". h2 "What the agent / did just now". A glass feed card (`--surface-glass`) on the right with eight rows: time, status pill, text. Each new "found" row lights a window and draws a callout line from its card to the window. Sample body: "Each line is one action: a site checked, a listing matched or skipped, a message sent, a reply read. The dashboard shows the same feed." Motion off: the final eight rows and the matching still.

**3. How it works (stage, K2, sticky).** Chip "How it works". h2 "From listing / to message". A sticky left column holds four steps (01 Watch, 02 Match, 03 Write, 04 Sort, with the base brief's copy). On the right, the camera looks down on the grid, and a glowing path runs from the left edge (the sites) to a window (match), into it (write), and back out (reply), lighting the step whose part of the path is active. The pipeline strip counts up once under the steps: "Checked 214  Matched 38  Sent 31  Replies 7  Viewings 2 (sample day)". Without JS: four static steps and a still with the full path drawn.

**4. Sources (band).** A mono label "Watches" and the site names as text, a marquee only at six or more sources. The Street is paused under the opaque band.

**5. Action inbox (stage, K4).** Chip "Action inbox". h2 "Only what needs / a person". A paper panel with the real dashboard screenshot (the base brief's light and dark pair) and, below it, the keyboard demo: three sample items and keys J, K, A, E, X, each with a visible button. Behind the panel, the camera holds on the needs-you window, blurred 6px (one still render, then the loop stops). Sample body: "A landlord who proposes a viewing or asks for a payslip needs you. The agent answers or closes the rest, and logs it."

**6. Claude and MCP (band with a still, night in both themes, K5).** Chip "Agent access". h2 "Ask Claude / what is waiting". The terminal demo on the right: a user line, the tool call chip `inbox_list` scrambling in, Claude's two-item answer, then `npx nl-property-finder status` printing the ASCII facade. When `inbox_list` appears, the two needs-you windows pulse in the still or the live scene. Below it, the config snippet with a copy button. Sample body: "The agent runs an MCP server. Add it to Claude Desktop or Claude Code and Claude can read your inbox and draft replies. Nothing is sent until you approve it." (Confirm the approval rule against the implementation.)

**7. Privacy (stage, K6).** Chip "Privacy". h2 "Your computer, / your data". A 2x2 bento of the base brief's four points, on paper tiles. In the scene, a dashed box outlines "your computer" around the street; short streaks leave only to the left, each labelled with a site name in mono; nothing leaves to the right, because there is no server. Sample tile: "There is no telemetry. Nothing is sent to the author, and there is no server to send it to."

**8. Cost (band, K7).** Chip "Cost". h2 "What it costs". The base brief's table unchanged. Canvas faded out, loop stopped.

**9. Contribute (stage, K8).** Chip "Contribute". h2 "Add a rental site / in one file". The adapter code block on the left. On the right, a seventh house rises from the grid as the code block enters view (0.9 s), with its windows appearing as the lines of the code block highlight. Sample body: "Each site is one adapter with four functions. Copy an existing one, change the selectors, and open a pull request."

**10. Footer (stage, K9).** The street at night, every window lit, particles drifting. The giant `NL-PROPERTY-FINDER` wordmark slides with scroll. Links, the font and GSAP credits, the Motion and Sound toggles, and the base brief's line "This page makes no third-party requests and sets no cookie."

### 7.6 Accessibility and input

- **Motion toggle.** "Motion: on" / "Motion: off" in the nav (mono, a real button with `aria-pressed`) and in the footer. It defaults to off when the OS asks for reduced motion and is remembered in `nlpf-motion`. Off means: stills instead of the live scene, no scramble, no split reveals (text simply present), no blinking, no marquee, no counting, no parallax, no magnetic pull, no moving grain. This also satisfies WCAG 2.2.2 for anything that moves longer than 5 s.
- **Keyboard.** The tab order follows reading order. Callout cards are buttons whose `aria-describedby` points at the matching feed row. Focus drives the camera (an 0.6 s ease, or a cut when motion is off) and the highlight frame. The focus ring is 2px `--focus` with a 3px offset and is never clipped (§7.2). The inbox demo keys only work while focus is inside the demo region, and every key has a matching button.
- **Screen readers.** The canvas, the posters, the stills, the data labels, the rules, the slashes and the bars are all `aria-hidden` or have empty `alt`. The hero figure's caption says what the scene shows: "A sample street: each lit window is a listing the agent found in this sample run." SplitText's `aria: "auto"` covers the h2 reveals; scrambles use the duplicate pattern (§7.3.8). One polite live region serves the inbox demo only.
- **No JS.** Every section renders: posters and stills, callouts at precomputed positions, the static feed, the sticky steps, the full terminal transcript. The sources row is static; the toggles are hidden (`.js` gates them).
- **Forced colours and transparency.** `@media (forced-colors: active)` hides the canvas, posters and bleed and keeps text on system colours. `@media (prefers-reduced-transparency: reduce)` swaps glass for solid surfaces.
- **Touch.** Phones get stills (the gate returns false for coarse pointers under 900px). Tap targets are at least 44px.

### 7.7 Performance budget

Gzip sizes, because GitHub Pages serves gzip even when brotli is requested (checked on pages.github.com and danieltyukov.github.io: `content-encoding: gzip`, `cache-control: max-age=600`).

| Item | Budget | Basis |
|---|---|---|
| HTML, with inline critical CSS and the head script | 18 KB | |
| CSS (`tokens.css` plus `style.css`) | 14 KB | |
| Fonts: JetBrains Mono, Instrument Serif italic, Instrument Sans wght | 82 KB | measured 30.7 + 21.6 + 29.4 KB |
| `main.js` (nav, feed simulation, reveals, rail, toggles, gate) | 10 KB | |
| Hero poster, AVIF, 1440w | 65 KB | measured 41 KB light, 63 KB dark |
| **First view without 3D** | **about 190 KB** | Solais transfers 3.7 MB; the median reference ships 1,250 KB of JS alone |
| `motion.js`: GSAP core, ScrollTrigger, SplitText, ScrambleText | 55 KB | measured 53.4 KB with DrawSVG |
| `stage.js`: three plus the scene | 160 KB | measured 143 KB for the proof |
| **With motion and 3D** | **about 405 KB** | |
| Section stills (only when the stage is off), each | 60 KB | lazy |
| Action inbox screenshot pair, AVIF, each | 90 KB | lazy |
| OG image | 150 KB | not on the page |

Runtime budget:

| Metric | Target | References (fast machine) |
|---|---|---|
| LCP, Lighthouse desktop and a 4x CPU plus Fast 4G run | under 1.5 s | Solais 4.7 s, Extropic 7.5 s, Oryzo 3.7 s |
| CLS | under 0.02 | Solais 0.025 |
| Longest main-thread task after load | under 50 ms (`compileAsync`, work split over idle callbacks) | |
| rAF callbacks per second while animating, and at rest | 60, and 0 | Solais 305 and 305 |
| rAF with reduced motion | 0 | 12 of 19 unchanged |
| Draw calls, triangles | at most 30, at most 50k | proof 13, 4.4k |
| GPU memory | under 64 MB | |
| Frame time p90 on a mid laptop | under 16.7 ms, degrading by the watchdog steps otherwise | |

Enforced in CI (`.github/workflows/site.yml`, on changes under `site/`):

1. `size-limit` on `dist/assets/*.js` using the budgets above.
2. Lighthouse CI on the built site: performance and accessibility at 95 or above, LCP under 1,500 ms, CLS under 0.02.
3. A Playwright test with `reducedMotion: 'reduce'` asserting that no WebGL context is created and that rAF callbacks in 2 idle seconds are 0.
4. A Playwright test with JavaScript disabled asserting that the h1, every h2 and the hero poster are visible.
5. A grep that fails on em or en dashes, emojis and the banned phrases in `site/index.html` (the copy rules as a test).

### 7.8 Build and files

```
site/
  index.html
  vite.config.ts           # base: '/<repo>/', build.target 'es2022', modulePreload { polyfill: false }
  src/
    main.ts                # nav, theme, motion toggle, feed simulation, reveals, rail, stage gate
    motion.ts              # dynamic: gsap, ScrollTrigger, SplitText, ScrambleText; scrubs, reveals, scramble
    stage/
      index.ts             # dynamic: renderer, loop, watchdog, lifecycle
      street.ts            # gable profiles, extrusion, window instancing, seventh house
      materials.ts         # scratch canvas, facade, glass, halo, highlight, grid shaders
      environment.ts       # procedural dusk and night environments
      camera.ts            # keyframes, Catmull-Rom path, scroll mapping, cursor parallax
      overlay.ts           # projection of anchors, callout lines, data labels
      events.ts            # feed event bus to windows
    styles/
      tokens.css           # shared with the dashboard (CI compares the copies)
      style.css
  public/
    fonts/  stills/  og.jpg  favicon.svg ...
  scripts/
    render-stills.ts       # Playwright plus sharp; writes public/stills/* and src/stage/stills.json
```

- Vite creates separate chunks for `motion.ts` and `stage/index.ts` because both are dynamic imports; three lands only in the stage chunk. Nothing preloads them at page load; Vite's preload helper fetches their dependencies only when the import runs.
- Import three by name (`import { WebGLRenderer, ... } from 'three'`), and take `RoomEnvironment`-style helpers from `three/examples/jsm/...` only if used. The proof's imports are the template.
- Pages workflow: replace the base brief's upload-as-is step with `npm ci && npm run build` in `site/`, then upload `site/dist`. Keep `concurrency: { group: pages, cancel-in-progress: false }`, minimal permissions and the `master` branch trigger.

### 7.9 The dashboard

Same tokens, same type grammar: uppercase mono labels, the chip, bracketed cards with the blinking square for items that need you, the slash breadcrumb in the top bar, clipped-corner primary buttons. No WebGL, no bleed, no grain except on empty states. The sidebar status keeps the base brief's 2D facade SVG, whose windows light with the same event names the site uses (`found`, `needs-you`), so the two stay one system.

---

## 8. Scorecard

| | Solais | Best reference on this point | This design (target) |
|---|---|---|---|
| LCP | 4.7 s | Lusion 0.23 s (text first) | under 1.5 s throttled; the h1 or the poster |
| First WebGL context | 3.5 s | Active Theory 0.18 s | about 1.8 to 2.8 s, after a first paint that already looks finished |
| JS | 758 KB | Abstract Intelligence 221 KB | about 225 KB with motion and 3D |
| Environment asset | 1.39 MB EXR | procedural, 0 bytes | procedural, 0 bytes |
| Render loops at rest | 305 rAF/s | Lovable 0 | 0 |
| Reduced motion | ignored | Hebbia, Krea stop their loops | stills, no loops, and a visible toggle |
| Without JS | "Loading..." forever | Extropic poster | posters, stills, callouts, all text |
| Keyboard access to the 3D | none | none | every hotspot is a button that drives the camera |
| Screen reader | text present, scramble loops | Hebbia (skip link, full SSR) | full text, scramble on duplicates, SplitText aria |
| Theme-aware 3D | no themes | none | dusk and night lighting with a view-transition switch |
| Sound | none | 5 sites, all muted by default | optional, off, synthesized, under 1 KB |

---

## 9. Risks and open questions

- **Look.** The proof proves composition, colour and cost; it does not yet match Solais's surface detail. The fronts read dark and the scratches show mainly on bevels. Budget a day of tuning (AO gradient, brick normal map, env panel placement) before judging.
- **Mid-laptop reality.** Every number here comes from a fast GPU. Before shipping, run the 4x CPU plus Fast 4G Lighthouse profile and a real Intel UHD laptop. The watchdog exists for this.
- **Headline claim.** "Within a minute" must be measured. If the median send time is higher, change the lede.
- **Poster drift.** Stills must be rerendered whenever the scene changes. Add a CI check that compares `stills.json`'s scene hash with the scene source hash.
- **Safari.** `compileAsync` falls back to sync compile where `KHR_parallel_shader_compile` is missing; expect a short hitch at stage start. `animation-timeline` is missing in some browsers; the footer type then stays static, which is fine.
- **GSAP terms.** They can change. The dependency is pinned in `package-lock.json`, and the licence link sits in the credits.
- **Scope.** Build order: hero, Street, posters, then sections 2, 3 and 5, then the rest. Sound and dithered images come last or not at all.

---

## 10. Screenshots and artefacts

All in `docs/design/refs/` (1440x900) unless noted.

| File | What it shows |
|---|---|
| 11-igloo-hero.png, 11-igloo-section.png | Igloo assembled from ice blocks; a scanned rock with mono annotations and callout lines |
| 11-extropic-hero.png, 11-extropic-section.png | Glowing display word over serif capitals on a hardware video; grainy golden noise panel |
| 11-oryzo-hero.png, 11-oryzo-section.png | Cork coaster on a cutting mat; the same object later, reframed in a dark section |
| 11-lusion-hero.png, 11-lusion-section.png | Glossy physics shapes; the showreel card with crosshair marks |
| 11-modal-hero.png, 11-modal-section.png | Glowing glass cube with particles; workload cards |
| 11-raycast-hero.png, 11-raycast-section.png | Red ribbon shader behind centred type; dark feature grid |
| 11-resend-hero.png, 11-resend-section.png | Monochrome 3D cube beside a serif headline; code panel |
| 11-spline-hero.png, 11-spline-section.png | Floating 3D shapes on a perspective grid; showcase grid |
| 11-worldlabs-hero.png, 11-worldlabs-section.png | 3D machine with "Click to explore"; serif editorial section |
| 11-hebbia-hero.png, 11-hebbia-section.png | Dark 3D fan with uppercase serif; blue-sky arc and product cards |
| 11-composio-hero.png, 11-composio-section.png | Equaliser-bar shader around the hero; numbered tabs with UI panels |
| 11-krea-hero.png, 11-krea-section.png | Particle starfield around the prompt; model cards |
| 11-shopify-editions-hero.png, 11-shopify-editions-section.png | 3D shelf of editions; Spring '26 point-cloud painting with type wrapped on a cylinder |
| 11-basement-hero.png, 11-basement-section.png | Live 3D office; featured projects with a particle prism |
| 11-activetheory-hero.png, 11-activetheory-section.png | Glass logo on dark; the same with particles |
| 11-abstract-intelligence-hero.png, 11-abstract-intelligence-section.png | Marble bust in clouds with pixel display type; framed chapter cards |
| 11-unicorn-hero.png, 11-unicorn-section.png | Aurora shader hero; shader-agent demo |
| 11-twelvelabs-hero.png, 11-twelvelabs-section.png | Helix of video tiles; pastel feature panel |
| 11-lovable-hero.png, 11-lovable-section.png | WebGL gradient hero with a prompt; dark infrastructure section |
| 99-proof-3d-light.png, 99-proof-3d-dark.png | The Street proof render in both themes: bleed, slash nav, chip, headline, callout with line, data labels, grid, grain |

Working files in `scratchpad/`: `p3d/results.json`-style data per batch (`p3d/a`, `b`, `c`, `d` and `p3d/final/results-*.json`), early frames at 1.2 s (`p3d/*/*-early.jpg`), no-JS and reduced-motion renders (`p3d/final/*-nojs.jpg`, `*-reduce.jpg`, `nojs-sheet.jpg`), scroll-path frame strips (`p3d/frames/sheet-*.jpg`, `p3d/solais/sheet.jpg`), Solais shaders and bundle (`p3d/solais/`), library size builds (`libsize/`), the proof (`proto3d/`: `index.html`, `scene.js`, `shots/poster-*.avif`).
