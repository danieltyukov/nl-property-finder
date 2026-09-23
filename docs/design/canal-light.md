# nl-property-finder: design direction brief

Scope: one visual system for (a) the one-page project site in `site/` on GitHub Pages, (b) the local web dashboard, and (c) the logo. Everything below uses free Google Fonts, plain CSS and inline SVG. No framework on the site.

Evidence used: computed styles and stylesheet scans of the ten reference sites (Playwright, 1440x900, 2026-09-23), hero and mid-page screenshots in `docs/design/refs/`, the owner's three recent sites (`owl-transfer`, `to-hoot`, `meeting-copilot`), and a proof render of this direction (`refs/99-proof-*.png`) that checks the tokens and recipes in both themes.

---

## 1. Direction: Canal Light

**Rationale.** Canal Light takes the thing every Dutch renter looks at, a row of canal-house facades, and makes each lit window a listing the agent has found, so the logo and the live parts of the product come from one drawing. Around it sits a Swiss-style grid with a quiet serif display, mono labels for anything the agent reports, and one warm dusk gradient kept for the moments that involve the person, such as a reply waiting or the primary button. The effects that make the references feel expensive (mesh gradients, grain, reeded glass, floating live toasts) are rebuilt in plain CSS and inline SVG, so the page stays as small and accessible as the owner's other sites.

**The idea in one picture.** Dusk over a canal. Warm light low on the horizon, a cool blue-grey sky above, dark gable silhouettes in front, and a few windows lit. In the dark theme it becomes the same street at night, which is where the motif is strongest.

**What each reference contributes (and what is left out)**

| Reference | Taken | Left out |
|---|---|---|
| Dawn (gradients) | Warm sunrise gradient as the single accent, radial-gradient primary button, soft glow shadow, large rounded inset panel for the hero visual | Photography, rotating decorative arcs |
| Lio (fluted glass) | Reeded-glass streaks over the hero art, two-tone headline idea (muted lead-in, strong words) | The looping video that produces the effect |
| Wispr Flow | Serif display with one italic phrase, floating rounded nav, product shown as small live widgets rather than a screenshot | Curved text paths, lilac/coral palette |
| Rime (Swiss) | Grid discipline, mono uppercase labels in tinted pills, dotted rules, dot grids, `cubic-bezier(.22,1,.36,1)` as the house easing, pill buttons | Condensed grotesk headline, Lenis smooth scroll, canvas visuals |
| CoFounder (pixels) | Floating "task" toasts over the hero, tactile buttons with inset highlights, pixel grid as a motif (the facade windows), spring pop for toasts | Pixel-art illustration, video hero |
| Solais (3D) | Film grain, technical mono annotations | WebGL. At 4.5 s after navigation the site still showed a blank loader (`refs/06-solais-hero.webp` had to be retaken at 9 s) |
| Edra (enterprise) | Restraint, a small dot before the label inside pills, muted body copy, olive-tinted neutrals | Commercial serif |
| Crusoe (technical) | Tight-tracked mono for data and telemetry, hairline dividers | Acid lime, industrial video |
| DeepJudge (sophisticated) | Big serif headlines with negative tracking, mono-labelled source cards joined by dashed curves | Barcode motif, violet accent |
| Joyful Health (approachable) | Outlined eyebrow pill with a dot, warm aura behind a lifted product card, chip rows with edge fades | Cooper-style soft serif |

---

## 2. What the references actually do (measured)

Values are `getComputedStyle` results and stylesheet scans. "Commercial" means licensed; free Google Fonts lookalikes are listed for each.

### 2.1 Typography

| Site | Display | Body / UI | Mono / labels | Measured headline |
|---|---|---|---|---|
| Dawn | Source Serif 4 (Google) | Figtree (Google) | none | h2 42 to 58px, wght 400, lh 48/64px, ls normal to -0.2px |
| Lio | Reckless Standard Light (commercial). Lookalikes: Newsreader (opsz 72, wght 300), Fraunces (wght 300, SOFT 0), Instrument Serif | STK Bureau Sans (commercial). Lookalikes: Inter Tight, Hanken Grotesk | ABC Diatype (commercial). Lookalike: Geist | h1 64px/70px, wght 200; first words at 50% white |
| Wispr Flow | EB Garamond (Google) | Figtree (Google) | IBM Plex Mono (Google) | h1 96px/91px, ls -0.03em (-2.88px); lede Figtree 20/26 wght 500 |
| Rime | NaN Holo Condensed (commercial). Lookalikes: Archivo at wdth 62 to 75 wght 700, Archivo Narrow, Instrument Sans wdth 75 | NaN Holo Narrow. Lookalike: Archivo wdth 85 | NaN Holo Mono. Lookalikes: JetBrains Mono, Space Mono | h1 96px/96px wght 700 ls -0.01em; h2 68px/54px |
| CoFounder | TT Neoris (commercial). Lookalikes: Onest, Figtree, Manrope | same | Departure Mono (free OFL, not on Google Fonts; Google lookalikes: Tiny5, Silkscreen, Pixelify Sans), IBM Plex Mono | h1 46px/49.7px wght 400 |
| Solais | teknolog (commercial). Lookalikes: Chakra Petch, Oxanium | "ki" (commercial). Lookalikes: Space Mono, Martian Mono, Azeret Mono | same | h1 72px/72px uppercase |
| Edra | Bradford LL (commercial). Lookalikes: Newsreader, Source Serif 4, Literata | ABC ROM (commercial). Lookalike: Hanken Grotesk | ABC ROM Mono. Lookalikes: DM Mono, IBM Plex Mono | h1 37.4px/44.9px ls -0.01em; body 17/26 color #85867A |
| Crusoe | ABC Diatype Mono (commercial). Lookalikes: Geist Mono, DM Mono, Martian Mono | Suisse Intl (commercial). Lookalikes: Inter Tight, Geist, Hanken Grotesk | same as display | h1 80px/84px ls -0.05em (-4px) |
| DeepJudge | Suisse Works (commercial). Lookalikes: Newsreader (opsz 72), Instrument Serif, Libre Caslon Display | Suisse Intl. Lookalikes as above | Suisse Intl Mono. Lookalikes: Geist Mono, JetBrains Mono | h1 96px/96px ls -0.05em (-4.8px); h2 64px ls -0.04em |
| Joyful Health | Cooper LT (commercial). Lookalike: Fraunces (wght 300, SOFT 100) | Saans (commercial). Lookalikes: Figtree, Onest | none | h1 64px/70px wght 200 ls -0.015em |

Pattern: six of ten use a serif display, and the rest use a condensed grotesk or a mono. Almost every site adds a mono for labels. Negative tracking on large display type runs from -0.01em to -0.05em.

### 2.2 Colour, surfaces, shape

| Site | Ground / ink | Accent(s) | Radii | Buttons | Nav |
|---|---|---|---|---|---|
| Dawn | Frame #321C04, cream oklch(0.968 0.014 67) about #FBF3EB | #FF9C31, scale #FFF8E0 to #5B3205 | 28px cards, 20px inset panels, pill | `radial-gradient(83.67% 348.78% at 100% 0%, #FF9C31 9%, #FFBE4A 55%, #FFDF62 100%)`, 48px tall, 0 24px, ink text | transparent over hero |
| Lio | Dark teal/slate video, #010203 | white at 50% for muted words | 2px buttons, 120px chips | 40px, 2px radius, ink | blur(10px) |
| Wispr | Cream #FFFFEB, ink #1A1A1A | Deep green #034F46, lilac #F0D7FF, coral #FF6C4C, orange #FFA946 | 8px CTA, 16px nav, 48px media | 52px, 2px ink border, 8px radius, lilac fill | floating 16px-radius box with segmented pill |
| Rime | Paper #F0E9DD, ink #24211D, #DDD6C9, taupe #958A7A | Cyan #2CC3E9, pink #FFA0FF, yellow #FFD46F | pill everywhere, 16 to 28px cards | 54px pill, 16px 24px, ink or #DDD6C9 | plain |
| CoFounder | #F5F5F2, ink #171717 | Amber #F59E0B, green #34A853, orange #FF672F | 8px, 4px, 10px | 41px, 8px radius, layered inset shadows | glass pills, blur(16px) saturate(1.19) |
| Solais | Crimson #3C091E, #97494E, #B74951, white | same | square, clipped corner | uppercase mono, clipped corner | slash-separated uppercase |
| Edra | Off-white #FFFFF9, olive ink #363726, #494939, muted #85867A, surface #F2F3EB | Yellow #FFF781 | 8px, 20px, 100px | yellow pill with black dot, 32.75px, mono uppercase | two small squared chips |
| Crusoe | Black, white, olive #3C4C2E | Acid lime #CEEB13 | 4px | 32px, 4px radius, mono, outline or lime | mono links, hairline under |
| DeepJudge | Warm grey #EDE9E5, #E6E0DB, ink #1A1A1A | Violet #9478FC | 4px, 8px | 44px, 2px radius | centred dark bar #1A1A1A |
| Joyful | Cream #F4F0E4, ink #363007, #FFFBEE | Yellow #FBC320, pink #EB87E9, crimson #BE123C | 6px buttons, 12px cards, pill eyebrows | 40 to 48px, 6px radius, yellow fill | plain, hairline under |

### 2.3 Backgrounds, texture, glass

- Mesh and sunrise gradients (Dawn): stacked radial gradients, e.g. `radial-gradient(circle at 100% 100%, #ED6516, #FF9C31 30%, #FBC81C 46%, cream 79%)`, plus a conic ring and `box-shadow: 0 0 40px #FF9C31` glow.
- Reeded glass (Lio): baked into a hero video (vertical streaks). No CSS ribs were found. Backdrop blurs of 4 to 20px on overlays.
- Pixel and scanline texture (CoFounder): `repeating-linear-gradient(0deg,#ffffff0f 0 1px,#0000 1px 3px), repeating-linear-gradient(90deg,#ffffff0a 0 1px,#0000 1px 3px)`; glass pills `blur(16px) saturate(1.1 to 1.19)`.
- Dot grid and dotted rules (Rime): `radial-gradient(circle, rgba(31,27,25,.5) 1.5px, transparent 1.6px)` and `repeating-linear-gradient(90deg,#DDD6C9 0 3px,#0000 3px 7px)`; `mix-blend-mode: multiply` on illustrations.
- Grain (Solais): full-bleed film grain over a WebGL canvas.
- Aura (Joyful): large blurred orange-pink glow behind a lifted card.

### 2.4 Motion (measured)

| Site | Easing curves found | Durations | Named animations |
|---|---|---|---|
| Rime | `cubic-bezier(.22,1,.36,1)` x14, `(.34,1.56,.64,1)` x3, `(.16,1,.3,1)` | 0.3s default, 0.35 to 0.5s custom | heroLogoMarquee 80s linear |
| Wispr | `(.34,1.56,.64,1)`, `(.4,0,.2,1)`, `(.22,1,.36,1)` | 0.12 to 0.32s | logoTicker1 40s linear |
| CoFounder | `(.215,.61,.355,1)`, `(.22,1,.36,1)`, `(.23,1,.32,1)`, `(.34,1.3,.64,1)` | 0.06 to 0.3s | notif-slide 0.48s `(.22,1,.36,1)`, notif-pop 0.52s `(.34,1.56,.64,1)`, hero-enter 0.6s, shimmer 2.8s |
| Joyful | `(.76,0,.24,1)`, `(.87,0,.13,1)` | 0.4 to 0.6s | question-scroll 35s and 42s linear |
| DeepJudge | `(.77,0,.175,1)` | 0.2s | none |
| Crusoe | ease | 0.1 to 0.5s | scroll-left 90s linear |
| Dawn | `(.175,.885,.32,1.175)` | 0.15 to 0.3s | spin 500s linear |

Consensus: an ease-out quint for entrances, a mild overshoot spring only for small pops, ease-in-out for panel moves, and marquees between 35s and 90s.

### 2.5 How they show the product

None of the ten puts a full product screenshot in the hero. They abstract the product into a few live components (Wispr's waveform pill, CoFounder's task toasts, DeepJudge's labelled source cards) or into art (Rime's dot waveform, Solais's 3D mark). Real UI appears lower down, in a rounded frame, often simplified. Canal Light follows that: live components in the hero, real screenshots in the Action inbox section.

---

## 3. Conventions to keep from the owner's sites

Read from `owl-transfer/site`, `to-hoot/site`, `meeting-copilot/site` and their `pages.yml`.

1. **Blocking theme script in `<head>`**, before the stylesheet link, wrapped in try/catch, reading one key and setting `data-theme` on `<html>`. Comment explains why it blocks. Key for this project: `nlpf-theme`. Also add `document.documentElement.classList.add('js')` here so reveal styles apply only when JS runs.
2. **Theme toggle** (`theme.js`, `type="module"`): a real `<button id="theme" aria-pressed>` whose visible word ("Dark mode") is the accessible name, with a small half-filled circle SVG (`aria-hidden="true" focusable="false"`). Click stores `light` or `dark`; "system" is reachable by clearing storage; listens to `matchMedia('(prefers-color-scheme: dark)')` changes only to keep `aria-pressed` honest. Copy the owl-transfer file and change the key.
3. **Dark tokens declared twice**: inside `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { ... } }` and again under `:root[data-theme='dark'] { ... }`.
4. **Skip link first in `<body>`** (`<a class="skip" href="#main">Skip to content</a>`), and `<main id="main" tabindex="-1">` so focus moves (owl-transfer comment explains the browser quirk).
5. **Explicit `body` background** ("a transparent body borrows whatever the browser paints behind it").
6. **Focus**: `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` and `:focus:not(:focus-visible) { outline: none }`.
7. **Sections** use `aria-labelledby` pointing at the h2 id, with a small `.micro` eyebrow above each h2.
8. **Images** always carry `width` and `height`, and alt text that describes what is on screen in concrete terms. Light and dark screenshot pairs are swapped with classes (`.shot-light`/`.shot-dark`), each with its own alt.
9. **Hero demo**: plays once; with `prefers-reduced-motion` or without JS the final frame is shown (meeting-copilot pattern). A caption says it is a sample.
10. **Tokens shared with the app** so the site "cannot drift away from the thing it is a picture of", and no colour literals outside the tokens file.
11. **Button colour pairs flip with the theme** so both directions clear 4.5:1 (to-hoot comment).
12. **Comments** are full sentences explaining intent and trade-offs, at the top of each file and above anything non-obvious.
13. **Footer**: source, changelog, contributing, issues, licence; a font licence credit; and, when fonts are self-hosted, "This page makes no third-party requests and sets no cookie."
14. **Head metadata**: description, canonical, `og:*`, `theme-color`, SVG favicon plus PNG fallback.
15. **`pages.yml`**: the meeting-copilot no-build variant (upload `site/` as is), `concurrency: { group: pages, cancel-in-progress: false }`, minimal permissions, the comment about setting Pages to "GitHub Actions" once. This repo's default branch is `master`.

---

## 4. Design tokens

### 4.1 `tokens.css` (single source)

Contrast ratios in the comments were computed with the WCAG formula for these exact hex values.

```css
/*
 * Canal Light tokens. The dashboard and the site both read this file, so the
 * page cannot drift away from the product it shows. Nothing outside this file
 * writes a colour literal.
 */

:root {
  color-scheme: light;

  /* Ground and ink */
  --bg: #F5F2EA;                            /* paper */
  --bg-sunk: #ECE7DC;                       /* alternate bands, table heads, sidebar */
  --surface: #FDFCF8;                       /* cards */
  --surface-glass: rgb(253 252 248 / 0.72); /* feed card over the hero art */
  --text: #13201F;                          /* 14.97:1 on --bg */
  --muted: #56625F;                         /* 5.67:1 on --bg */
  --faint: #8A9491;                         /* 2.79:1: decoration only, never text */
  --line: rgb(19 32 31 / 0.12);
  --line-strong: rgb(19 32 31 / 0.22);
  --hover: rgb(19 32 31 / 0.05);
  --dot: rgb(19 32 31 / 0.16);

  /* Dusk, the only accent family */
  --haze: #FFD9A8;
  --apricot: #FFB26B;
  --oranje: #FF7A33;
  --brick: #E0582F;
  --sky: #A9C1D6;                           /* the cool side of the hero mesh */
  --accent-text: #A63E17;                   /* links and accent words, 5.65:1 on --bg */
  --on-accent: #13201F;                     /* text on the dusk gradient, 6.45:1 at --oranje */
  --focus: #A63E17;

  /* Agent status: pills, feed verbs, row markers. All 4.8:1 or better on their 12% tint. */
  --st-found: #2A67A6;
  --st-contacted: #1F6F66;
  --st-needs-you: #A8431A;
  --st-viewing: #6149C2;
  --st-closed: #5F6765;
  --st-error: #B3261E;
  --st-live: #1F6F66;

  /* The facade */
  --gable: #13201F;
  --window-off: rgb(245 242 234 / 0.16);    /* paper tint on ink, so unlit windows still read */
  --window-lit: #FF9A4D;

  /* Gradients */
  --grad-dusk: linear-gradient(135deg, var(--apricot) 0%, var(--oranje) 100%);
  --grad-dusk-wide: linear-gradient(100deg, var(--haze) 0%, var(--apricot) 38%, var(--oranje) 72%, var(--brick) 100%);
  --mesh-hero:
    radial-gradient(60% 55% at 12% 92%, rgb(255 122 51 / 0.55) 0%, rgb(255 122 51 / 0) 70%),
    radial-gradient(55% 50% at 40% 72%, rgb(255 178 107 / 0.60) 0%, rgb(255 178 107 / 0) 70%),
    radial-gradient(70% 60% at 90% 6%, rgb(169 193 214 / 0.80) 0%, rgb(169 193 214 / 0) 70%),
    radial-gradient(50% 45% at 68% 38%, rgb(255 217 168 / 0.55) 0%, rgb(255 217 168 / 0) 70%);
  --aura: radial-gradient(closest-side, rgb(255 122 51 / 0.40), rgb(255 178 107 / 0.18) 55%, rgb(255 178 107 / 0) 100%);
  --grain-opacity: 0.22;
  --grain-blend: multiply;

  /* Type families */
  --font-display: "Instrument Serif", "Instrument Serif Fallback", Georgia, "Times New Roman", serif;
  --font-sans: "Instrument Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* Site scale (fluid) */
  --fs-display: clamp(3rem, 1.9rem + 4.6vw, 5.5rem);      /* 48 to 88px, h1 */
  --fs-h2: clamp(2.25rem, 1.6rem + 2.6vw, 3.75rem);       /* 36 to 60px */
  --fs-h3: 1.25rem;                                       /* 20px, sans 600 */
  --fs-lede: clamp(1.125rem, 1.02rem + 0.45vw, 1.3125rem);/* 18 to 21px */
  --fs-body: 1.0625rem;                                   /* 17px */
  --fs-small: 0.9375rem;                                  /* 15px */
  --fs-micro: 0.75rem;                                    /* 12px mono uppercase */
  --lh-display: 0.98;
  --lh-h2: 1.04;
  --lh-body: 1.6;
  --ls-display: -0.015em;
  --ls-h2: -0.01em;
  --ls-h3: -0.01em;
  --ls-micro: 0.08em;

  /* Dashboard scale (fixed, dense) */
  --fs-ui-xs: 11px;      /* mono labels, table heads */
  --fs-ui-sm: 12.5px;    /* mono meta, feed lines */
  --fs-ui-md: 13.5px;    /* table cells, nav items */
  --fs-ui: 14px;         /* base */
  --fs-ui-lg: 16px;      /* card titles */
  --fs-ui-xl: 20px;      /* page titles, sans 600 */
  --fs-ui-stat: 28px;    /* numbers, sans 600, wdth 85, tabular */

  /* Radii */
  --r-xs: 4px;   /* kbd, tiny chips */
  --r-sm: 8px;   /* dashboard buttons, inputs */
  --r-md: 12px;  /* cards, toasts, feed */
  --r-lg: 20px;  /* feature panels, screenshot frames */
  --r-xl: 28px;  /* the hero pane */
  --r-pill: 999px;

  /* Shadows */
  --shadow-1: 0 1px 2px rgb(19 32 31 / 0.06);
  --shadow-2: 0 1px 2px rgb(19 32 31 / 0.05), 0 8px 24px -12px rgb(19 32 31 / 0.18);
  --shadow-3: 0 2px 4px rgb(19 32 31 / 0.04), 0 24px 48px -16px rgb(19 32 31 / 0.28);
  --shadow-tactile: inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 -1px 0 rgb(0 0 0 / 0.12), 0 1px 2px rgb(19 32 31 / 0.16);
  --glow-dusk: 0 8px 20px -8px rgb(255 122 51 / 0.60);

  /* Space (4px base) */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px;
  --s-6: 32px; --s-7: 48px; --s-8: 64px; --s-9: 96px; --s-10: 128px;
  --gutter: clamp(16px, 4vw, 40px);
  --wrap: 1200px;
  --measure: 62ch;
  --section-y: clamp(4.5rem, 3rem + 7vw, 9rem);

  /* Motion */
  --dur-instant: 100ms;  /* colour on hover */
  --dur-quick: 160ms;    /* buttons, toggles */
  --dur-base: 240ms;     /* feed rows, drawers opening */
  --dur-slow: 400ms;     /* scroll reveals, window lighting */
  --dur-toast: 520ms;    /* toast pop, matches CoFounder's notif-pop */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);     /* default for everything that enters */
  --ease-in-out: cubic-bezier(0.76, 0, 0.24, 1);  /* panels that move from one place to another */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* toasts and pills only */
}

/*
 * Dark: the same street at night. Declared twice, as in to-hoot: once for a
 * visitor on system dark with no stored choice, once for an explicit choice.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    /* The same declarations as the :root[data-theme='dark'] block below.
       They cannot share one rule, because only this copy sits inside the
       media query. Keep the two in sync (a CI grep can compare them). */
  }
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #0C1515;
  --bg-sunk: #091010;
  --surface: #142221;
  --surface-glass: rgb(20 34 33 / 0.72);
  --text: #ECF1EE;                          /* 16.21:1 */
  --muted: #9AA8A4;                         /* 7.51:1 */
  --faint: #6B7A76;                         /* decoration only */
  --line: rgb(236 241 238 / 0.10);
  --line-strong: rgb(236 241 238 / 0.18);
  --hover: rgb(236 241 238 / 0.05);
  --dot: rgb(236 241 238 / 0.12);
  --accent-text: #FFA56B;                   /* 9.57:1 */
  --on-accent: #0C1515;                     /* 7.9:1 on the gradient */
  --focus: #FFA56B;
  --st-found: #86B8EC;
  --st-contacted: #62C9B8;
  --st-needs-you: #FFAA70;
  --st-viewing: #B6A6F7;
  --st-closed: #A3ACA9;
  --st-error: #F2877E;
  --st-live: #62C9B8;
  --gable: #050A0A;
  --window-off: rgb(236 241 238 / 0.10);
  --window-lit: #FFB26B;
  --mesh-hero:
    radial-gradient(60% 55% at 12% 96%, rgb(255 122 51 / 0.42) 0%, rgb(255 122 51 / 0) 70%),
    radial-gradient(45% 40% at 42% 84%, rgb(255 178 107 / 0.20) 0%, rgb(255 178 107 / 0) 70%),
    radial-gradient(75% 65% at 92% 0%, rgb(58 96 122 / 0.60) 0%, rgb(58 96 122 / 0) 70%);
  --aura: radial-gradient(closest-side, rgb(255 122 51 / 0.28), rgb(255 122 51 / 0) 100%);
  --grain-opacity: 0.14;
  --grain-blend: overlay;
  --shadow-1: 0 0 0 1px var(--line);
  --shadow-2: 0 0 0 1px var(--line), inset 0 1px 0 rgb(255 255 255 / 0.04);
  --shadow-3: 0 0 0 1px var(--line), 0 24px 48px -16px rgb(0 0 0 / 0.60);
  --shadow-tactile: inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 -1px 0 rgb(0 0 0 / 0.20);
  --glow-dusk: 0 8px 24px -8px rgb(255 122 51 / 0.45);
}
```

Contrast checks (text colours on `--bg`, `--surface`, and on their own 12% or 16% tint for pills):

| Token | Light | Dark |
|---|---|---|
| text | 14.97 / 16.31 / 12.87 | 16.21 / 14.36 / 8.99 |
| muted | 5.67 / 6.18 / 5.25 | 7.51 / 6.65 / 5.02 |
| accent-text | 5.65 / 6.16 / 5.14 | 9.57 / 8.47 / 6.15 |
| st-found | 5.23 / 5.70 / 4.82 | 8.89 / 7.87 / 5.72 |
| st-contacted | 5.33 / 5.80 / 4.90 | 9.32 / 8.25 / 5.91 |
| st-needs-you | 5.39 / 5.87 / 4.93 | 9.91 / 8.77 / 6.29 |
| st-viewing | 5.79 / 6.31 / 5.31 | 8.63 / 7.64 / 5.61 |
| st-closed | 5.19 / 5.66 / 4.82 | 7.97 / 7.05 / 5.24 |
| st-error | 5.84 / 6.37 / 5.22 | 7.53 / 6.67 / 5.12 |
| ink on --oranje | 6.45 | bg on #FF8A45: 7.91 |

Do not put text on `--brick` (ink on it is 4.47:1). The gradient that carries text stops at `--oranje`.

### 4.2 Type

- **Display: Instrument Serif** 400 and italic (Google Fonts, OFL). A sharp, slightly condensed serif in the DeepJudge/Lio family. One italic phrase per headline at most (the Wispr move). h1 `var(--fs-display)`, lh 0.98, ls -0.015em, `max-width: 14ch` (the proof showed 11ch breaks into four lines at 88px). h2 `var(--fs-h2)`, lh 1.04, ls -0.01em, max 20ch.
- **Body and UI: Instrument Sans** variable (wght 400 to 700, wdth 75 to 100). Same foundry as the display face, and the owner already ships it in owl-transfer. Body 17px/1.6; lede 18 to 21px, colour `--muted`. h3 20px wght 600 ls -0.01em. Buttons 16px wght 600. Stat numbers use `font-variation-settings: "wdth" 85` with `font-variant-numeric: tabular-nums` for a Rime-like condensed figure without another font.
- **Mono: JetBrains Mono** variable (wght 400 to 600). Owner's existing mono. Used for eyebrows (12px, uppercase, ls 0.08em, wght 500), timestamps, addresses in the feed, prices in tables, code.
- **Loading**: self-host the four latin woff2 files from Google Fonts in `site/fonts/` (OFL text beside them). Measured latin sizes: Instrument Serif regular 21.0 KB, italic 22.1 KB, Instrument Sans (wght+wdth) 57.3 KB, JetBrains Mono (wght) 31.4 KB: about 132 KB total. If the site never uses `wdth`, request `wght` only for a smaller Instrument Sans.

```css
@font-face {
  font-family: "Instrument Serif";
  src: url("fonts/instrument-serif-400.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* Same pattern for the italic, Instrument Sans (font-weight: 400 700; font-stretch: 75% 100%) and JetBrains Mono (font-weight: 400 600). */

/* Metric-matched fallback so the swap does not move the headline. Generate the
   four values with a tool (fontaine, capsize, or Next's font fallback calc)
   against Georgia; do not guess them. */
@font-face {
  font-family: "Instrument Serif Fallback";
  src: local("Georgia");
  size-adjust: 0%; ascent-override: 0%; descent-override: 0%; line-gap-override: 0%; /* replace */
}
```

```html
<link rel="preload" href="fonts/instrument-serif-400.woff2" as="font" type="font/woff2" crossorigin>
```

If the fonts are loaded from Google instead, use `<link rel="preconnect" href="https://fonts.googleapis.com">` and `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` with `&display=swap`, and drop the "no third-party requests" footer line. Self-hosting is the recommendation because the project's pitch is local-first.

### 4.3 Layout

- 12-column grid, `max-width: var(--wrap)` (1200px), `padding-inline: var(--gutter)`, column gap 24px.
- Section rhythm: `padding-block: var(--section-y)`. Alternate `--bg` and `--bg-sunk` bands; the Claude/MCP band is dark in both themes (meeting-copilot's `.band.dark`).
- Text columns max `--measure` (62ch). Headlines flush left, ragged right, never centred except the final CTA.
- Hairline rules (`1px solid var(--line)`) and dotted rules separate content; no boxed sections except cards.

### 4.4 Recipes (working CSS)

**Grain overlay** (verified in the proof render; static, one 160px tile)

```css
.grain { position: relative; isolation: isolate; }
.grain::after {
  content: ""; position: absolute; inset: 0; z-index: 5; pointer-events: none;
  opacity: var(--grain-opacity); mix-blend-mode: var(--grain-blend);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px 160px;
}
```

Use it on the hero pane and the OG image only, not on the whole page.

**Hero pane (mesh)**

```css
.pane {
  position: relative; overflow: hidden; isolation: isolate;
  aspect-ratio: 16 / 13;            /* reserves the box: no layout shift */
  border-radius: var(--r-xl);
  background: var(--mesh-hero), var(--bg-sunk);
}
```

**Reeded glass pane** (verified; Lio's streaks without video)

```css
.fluted {
  border-radius: var(--r-lg);
  background:
    repeating-linear-gradient(90deg,
      rgb(255 255 255 / 0.28) 0px, rgb(255 255 255 / 0) 4px,
      rgb(255 255 255 / 0) 7px, rgb(0 0 0 / 0.07) 10px,
      rgb(255 255 255 / 0.28) 11px),
    rgb(255 255 255 / 0.10);
  -webkit-backdrop-filter: blur(14px) saturate(1.25);
  backdrop-filter: blur(14px) saturate(1.25);
  border: 1px solid rgb(255 255 255 / 0.45);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.55);
}
:root[data-theme='dark'] .fluted { /* and the media-query twin */
  background:
    repeating-linear-gradient(90deg,
      rgb(255 255 255 / 0.10) 0px, rgb(255 255 255 / 0) 4px,
      rgb(255 255 255 / 0) 7px, rgb(0 0 0 / 0.25) 10px,
      rgb(255 255 255 / 0.10) 11px),
    rgb(255 255 255 / 0.03);
  border-color: rgb(255 255 255 / 0.12);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.10);
}
@supports not (backdrop-filter: blur(1px)) {
  .fluted { background-color: rgb(255 255 255 / 0.35); }
}
```

Never put body text on the ribs. The pane is decoration; readable content sits on `--surface-glass` or `--surface`.

For stronger vertical streaks on the art behind the glass, blur the art inside its own SVG, which every browser supports (unlike `backdrop-filter: url()`):

```html
<svg viewBox="0 0 700 250" aria-hidden="true" focusable="false">
  <filter id="streak" x="-5%" y="-20%" width="110%" height="140%">
    <feGaussianBlur stdDeviation="1.5 12"/>
  </filter>
  <g filter="url(#streak)"><!-- a copy of the gables, clipped to the pane's area --></g>
</svg>
```

(Not in the proof render; check it on Safari before shipping.)

**Glass nav** (sticky floating pill; state set by an IntersectionObserver sentinel, not a scroll listener)

```css
.nav {
  position: sticky; top: 12px; z-index: 10;
  max-width: 960px; height: 56px; margin: 12px auto 0; padding: 0 8px 0 16px;
  display: flex; align-items: center; gap: var(--s-2);
  border: 1px solid transparent; border-radius: var(--r-pill);
  transition: background var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
}
.nav.is-stuck {
  background: color-mix(in oklab, var(--bg) 72%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  backdrop-filter: blur(14px) saturate(1.4);
  border-color: var(--line);
  box-shadow: var(--shadow-2);
}
@supports not (backdrop-filter: blur(1px)) { .nav.is-stuck { background: var(--bg); } }
```

**Buttons**

```css
.btn {
  display: inline-flex; align-items: center; gap: var(--s-2);
  min-height: 48px; padding: 0 22px; border-radius: var(--r-pill);
  font: 600 1rem/1 var(--font-sans); text-decoration: none;
  color: var(--text); background: transparent; border: 1px solid var(--line-strong);
  transition: background var(--dur-quick) var(--ease-out), border-color var(--dur-quick) var(--ease-out), transform var(--dur-quick) var(--ease-out);
}
.btn:hover { background: var(--hover); border-color: var(--text); }
.btn-primary {
  color: var(--on-accent); background: var(--grad-dusk); border-color: transparent;
  box-shadow: var(--shadow-tactile), var(--glow-dusk);
}
.btn-primary:hover { transform: translateY(-1px); background: var(--grad-dusk); }
.btn-primary:active { transform: none; }
```

**Eyebrow pill with a live dot** (Joyful's outlined pill, Edra's dot)

```css
.eyebrow {
  display: inline-flex; align-items: center; gap: var(--s-2);
  padding: 7px 12px 7px 10px; border: 1px solid var(--line-strong); border-radius: var(--r-pill);
  font: 500 var(--fs-micro)/1 var(--font-mono); letter-spacing: var(--ls-micro); text-transform: uppercase; color: var(--muted);
}
.live { position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--st-live); }
.live::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; background: inherit;
  animation: live-ping 2s var(--ease-out) infinite;
}
@keyframes live-ping { from { transform: scale(1); opacity: 0.6; } to { transform: scale(2.6); opacity: 0; } }
```

**Status pill** (verified)

```css
.pill {
  display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px 0 7px;
  border-radius: var(--r-pill); white-space: nowrap;
  font: 600 11.5px/1 var(--font-sans); letter-spacing: 0.01em;
  color: var(--c); background: color-mix(in oklab, var(--c) 12%, transparent);
}
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.found { --c: var(--st-found); }
.pill.contacted { --c: var(--st-contacted); }
.pill.needs-you { --c: var(--st-needs-you); }
.pill.viewing { --c: var(--st-viewing); }
.pill.closed { --c: var(--st-closed); }
.pill.error { --c: var(--st-error); }
@media (forced-colors: active) { .pill { border: 1px solid CanvasText; } }
```

**Dot grid and dotted rule** (Rime, Edra)

```css
.dotgrid { background-image: radial-gradient(circle, var(--dot) 1px, transparent 1.25px); background-size: 16px 16px; }
.rule-dotted { height: 1px; border: 0; background: repeating-linear-gradient(90deg, var(--line-strong) 0 2px, transparent 2px 6px); }
```

**Aura behind a product screenshot** (Joyful, without a blur filter)

```css
.shot { position: relative; isolation: isolate; }
.shot::before { content: ""; position: absolute; inset: -12% -8% -18%; z-index: -1; background: var(--aura); }
.shot img { border-radius: var(--r-lg); box-shadow: var(--shadow-3); }
```

**Facade windows** (the logo motif, animated in the hero)

```css
.facade .h { fill: var(--gable); }
.facade .w { fill: var(--window-off); transition: fill var(--dur-slow) var(--ease-out); }
.facade .w.lit { fill: var(--window-lit); }
.facade .w.ping { fill: var(--window-lit); animation: window-ping 1.2s var(--ease-out) 1; }
@keyframes window-ping {
  0% { filter: drop-shadow(0 0 0 transparent); }
  40% { filter: drop-shadow(0 0 8px var(--oranje)); }
  100% { filter: drop-shadow(0 0 0 transparent); }
}
```

**Toast pop** (CoFounder's notif-pop)

```css
.play .toast { opacity: 0; transform: translateY(8px) scale(0.96); transform-origin: 90% 0; }
.play .toast.in {
  opacity: 1; transform: none;
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-toast) var(--ease-spring);
}
```

**Marquee** (two identical lists so -50% lands exactly; the copy is `aria-hidden`)

```css
.marquee { overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
.marquee-track { display: flex; width: max-content; animation: marquee 60s linear infinite; }
.marquee-track > ul { display: flex; gap: 48px; padding: 0 48px 0 0; margin: 0; list-style: none; }
.marquee:hover .marquee-track, .marquee:focus-within .marquee-track, .marquee.is-offscreen .marquee-track { animation-play-state: paused; }
@keyframes marquee { to { transform: translateX(-50%); } }
```

**Scroll reveal** (content visible without JS; the head script adds `.js`)

```css
.js .reveal {
  opacity: 0; transform: translateY(12px);
  transition: opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out);
  transition-delay: calc(var(--i, 0) * 60ms);
}
.js .reveal.in { opacity: 1; transform: none; }
```

**Reduced motion** (one block, at the end of the stylesheet)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
  .live::after { animation: none; }
  .js .reveal { opacity: 1; transform: none; }
  .marquee-track { animation: none; flex-wrap: wrap; width: auto; }
  .marquee-track > ul[aria-hidden] { display: none; }
}
```

---

## 5. Landing page

### 5.1 Copy rules (owner's, applied to every line)

- No emojis. No em dashes or en dashes as punctuation; use a comma, colon, parentheses or a new sentence.
- No funnel tone: no "unlock", "supercharge", "seamless", "effortless", "revolutionise", "game-changer", "AI-powered" as an adjective, no exclamation marks, no rhetorical questions.
- No rule-of-three padding. If a list has three items, each must be a real, separate fact; otherwise cut to the ones that matter.
- No "isn't just X, it's Y", "not only... but also", "whether you're X or Y".
- Plain declarative sentences, one idea each, ending with a full stop. Headlines are sentences too (owner's "Press h. Say the next thing.").
- Numbers only when measured, with their unit. Name costs and limits honestly.
- Any demo is labelled as a sample. Never imply a landlord relationship, a guarantee of housing, or an affiliation with any listing site.
- List only listing sites the agent supports at release, as plain text names, never their logos. (Today's code reads Kamernet and Pararius; `package.json` also mentions Funda.)

The sample lines below follow these rules but are drafts: check every claim against the shipped features.

### 5.2 Sections

**0. Nav** (floating glass pill, recipe above)
Left: mark + wordmark `nl-property-finder`. Centre links: How it works, Inbox, Claude, Privacy, Cost. Right: the owner's theme toggle, then a ghost "GitHub" button. No live star count (it would be a third-party request). Mobile: links collapse into a `<details>` disclosure, not a JS drawer.

**1. Hero** (`--bg`, 12 columns: copy in 1 to 6, pane in 7 to 12; stacked on mobile with the pane below)

- Eyebrow pill with live dot: "Open source · runs on your machine"
- h1 options:
  - "The listings get watched. *You* answer the replies." (in the proof render)
  - "Stop refreshing Pararius. The agent writes first."
  - "A rental agent on your laptop that only interrupts you for a viewing."
- Lede: "It checks Dutch rental sites around the clock and writes to the landlord as soon as a listing matches your search. Replies are sorted, and only the ones that need a person reach you."
- Buttons: primary "Get started" (to the install section or README), ghost "Read the source".
- Fine print (mono 13px): "MIT licence. Node 20 or newer. No account, no server."
- **The agent pane** (`.pane.grain`, 28px radius, `aspect-ratio` reserved):
  - Background: `--mesh-hero`.
  - Bottom third: an inline SVG street of six gables (step, neck, bell, spout, cornice, step), filled `--gable`, each with a grid of `.w` windows.
  - Top right: a `.fluted` pane over the sky, optionally over a streak-blurred copy of the gable tops.
  - Left, overlapping: the feed card (`--surface-glass`, 12px radius, `--shadow-3`) with a mono header "Agent · live" and "next check 00:42", then five rows `time | pill | text`.
  - Lower right: a toast (`--surface`) with a "Needs you" pill, "Viewing proposed, Thu 26 Sep 18:30", the address in mono, and "Accept" / "Other time" buttons.
- **Sequence** (about 7 s, once): each feed row arrives every 0.9 to 1.3 s (fade and 4px rise, `--dur-base`); as a "Found" row lands, one window gets `.ping` then `.lit`; at about 6 s the toast pops with the spring. Then it holds the final frame. A small text button "Replay" under the pane restarts it. No loop.
- Reduced motion or no JS: the final frame, all windows lit as in the proof.
- Figure caption: "A sample run. Addresses and times are made up."
- Accessibility: the feed is a real `<ol>` of events, readable in order; the SVG street is `aria-hidden`; the figure has `aria-label="A sample run of the agent: five events and one reply that needs you"`.

**2. Sources marquee** (thin band directly under the hero, 64px tall, `--bg`)
Only worth a marquee with six or more sources. With fewer (today: two), show the same band as a static row. Mono micro label "Watches" at left, then the site names in Instrument Sans 500, 18px, `--muted`, separated by a small 8px gable glyph. 60s linear. Paused on hover, on focus and when off screen. Reduced motion: a static wrapped list.

**3. How it works** (`--bg-sunk` with `.dotgrid`)
- Eyebrow "How it works". h2 options: "One pass per listing. You come in at the end." or "From a new listing to a sent message, without you."
- Four columns on the grid, each with a 1px top rule, a mono step number ("01"), an h3 and two sentences:
  - 01 Watch: "It opens the search pages you set up on each site every few minutes and notes anything it has not seen before."
  - 02 Match: "Each listing is checked against your rent, size, area and move-in date. Near misses are logged, not sent."
  - 03 Write: "A match gets your message in the same check, in Dutch or English, with the listing's details filled in."
  - 04 Sort: "Replies are read and sorted. Anything that needs your decision goes to the inbox."
- Under each column, one mono example line in `--muted` (for example `every 2 min · 2 sites`).
- Optional DeepJudge-style diagram above the columns: mono-labelled source cards joined by dashed curves (`stroke-dasharray: 2 4`, `--line-strong`) into one "agent" card.

**4. Action inbox** (`--bg`; copy in columns 1 to 5, screenshot in 6 to 12)
- Eyebrow "Action inbox". h2: "Only what needs a person reaches you."
- Body: "A landlord who proposes a viewing time or asks for a payslip needs you. Everything else is answered or closed by the agent, and logged."
- A short keyboard line in mono with `<kbd>` keys: J K to move, A to accept, E to edit the draft, X to dismiss.
- Visual: the real dashboard screenshot (light and dark pair, AVIF plus WebP, `width`/`height` set) in a 20px-radius frame with `--shadow-3` and the `--aura` behind it.
- Alt text in the owner's style, for example: "The dashboard's Action inbox: three items that need a person, the first a landlord proposing a viewing on Thursday at 18:30 with a drafted reply and Accept, Edit and Dismiss buttons, and the live feed of the agent's checks in a column on the right."

**5. Claude and MCP** (dark band in both themes)
- Eyebrow "Agent access". h2: "Ask Claude what is waiting for you."
- Body: "The agent runs an MCP server. Add it to Claude Desktop or Claude Code and Claude can read your inbox and draft replies. Nothing is sent until you approve it." (Confirm the approval rule matches the implementation.)
- Right: a terminal-style panel (mono, `--r-md`, 1px line) with a short transcript: a user line, one tool call shown as a mono chip (`inbox_list`), and Claude's answer listing two items. Below it, the config snippet with a copy button. Tool and command names are placeholders until the MCP server exists:

```json
{
  "mcpServers": {
    "nl-property-finder": { "command": "npx", "args": ["nl-property-finder", "mcp"] }
  }
}
```

**6. Privacy, local first** (`--bg`)
- Eyebrow "Privacy". h2: "It runs on your computer, and so does your data."
- The owner's `dl.points` pattern (bold `dt` sentence, `dd` explanation):
  - "Listings and messages stay in a local file." The database path, and how to delete it.
  - "Site logins are stored on your disk." Where, and with which permissions.
  - "There is no telemetry." Nothing is sent to the author, and there is no server to send it to.
  - "What does leave your machine." Requests to the rental sites, the messages you approve, and prompts to Claude if you turn that on.
- A small `pre` flow diagram in the meeting-copilot style (box-drawing characters, mono) showing: rental sites, then the agent on localhost, then your inbox, with Claude as an optional side branch.
- Link to `PRIVACY.md` and `SECURITY.md`.

**7. What it costs** (`--bg-sunk`)
- Eyebrow "Cost". h2: "Free to run. The one optional cost is listed here."
- Table (sans body, mono numbers, hairline rows, first column `th scope="row"`):

| Part | Cost | Notes |
|---|---|---|
| The agent | €0 | MIT licence, runs on your computer |
| Listing sites | €0 | Uses your own free accounts where a site needs a login |
| Notifications | €0 | Desktop notifications from the dashboard |
| Reply sorting with Claude | €0 to a few euros a month | €0 through MCP in a Claude plan you already have; pay per use with an API key; or off |
| Hosting | €0 | Nothing is hosted. This page is on GitHub Pages. |

Tone: exact, no asterisks, no "starting at". Replace the Claude row with measured figures once known.

**8. Open source, contribute** (`--bg`)
- Eyebrow "Contribute". h2: "Add a rental site in one file."
- Body: one paragraph on the source adapter interface, then a short code block (placeholder shape: `name`, `searchUrl(filters)`, `parseListings(html)`, `contact(listing, message)`), then links: CONTRIBUTING.md, good first issues, the architecture doc.
- No star counters, no contributor avatars (third-party requests).

**9. Footer** (`--bg`, hairline top)
Mark + "nl-property-finder. MIT licence." Links: Source, Changelog, Contributing, Issues. Then the font line ("Set in Instrument Serif, Instrument Sans and JetBrains Mono, each under the SIL Open Font License 1.1.") and, when self-hosted, "This page makes no third-party requests and sets no cookie."

### 5.3 Head

```html
<meta name="theme-color" content="#F5F2EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0C1515" media="(prefers-color-scheme: dark)">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="assets/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<meta property="og:image" content="https://danieltyukov.github.io/<repo>/assets/og.png">
```

OG image (1200x630): the dark "street at night" pane with lit windows, the wordmark and the h1. Static PNG.

---

## 6. Dashboard

### 6.1 Layout

```
+-----------+----------------------------------------------------------------+
| [mark]    |  [/ Search listings or run a command  Ctrl K]   [* Running · next 0:42] [Pause] [Dark mode] |
|           +----------------------------------------------------------------+
| Inbox   3 |  Pipeline strip: Seen today 214 | Matched 38 | Sent 31 | Replies 7 | Viewings 2 |
| Listings  +-----------------------------------------+----------------------+
| Messages  |  ACTION INBOX                        3  |  LIVE FEED           |
| Sources   |  item                                   |  21:30:51 [Error] .. |
| Areas     |  item                                   |  21:26:05 [Needs] .. |
| Settings  |  item                                   |  21:11:40 [Skip]  .. |
| Logs      |                                         |  ...                 |
|           |                                         |                      |
| * Agent   |                                         |                      |
|  2 sites  |                                         |                      |
+-----------+-----------------------------------------+----------------------+
```

- **Sidebar** 232px (collapses to a 60px icon rail below 1100px or on demand), `--bg-sunk`, no border shadow. Items 32px tall, 13.5px Instrument Sans 500, 16px line icons (1.5px stroke). Active item: `--surface` background, 1px `--line`, `--r-sm`. The Inbox count uses the dusk gradient badge (the only gradient in the chrome). Bottom block: the mark with its window pulsing while the agent runs, "Checking 2 sites", last check time in mono.
- **Top bar** 52px: command field (Ctrl K / Cmd K opens a palette: "Pause agent", "Check now", "Open inbox", "Add search area", "Go to listing..."). On the right: agent status pill (live dot, "Running · next check 0:42"; grey "Paused"; red "Error: Pararius login expired"), Pause/Resume, theme toggle.
- **Home is the inbox**, not charts. The current coloured gradient stat cards go; they compete with the one thing that matters.
- **Pipeline strip**: five numbers in Instrument Sans wght 600, wdth 85, 28px, tabular, each with a mono 11px uppercase label and an optional 14-day sparkline (1.5px `--text` line at 40% opacity, no fill). Hairline dividers between numbers.
- Page padding 24px, card gap 16px, card padding 16px.

### 6.2 Density and components

- Base 14px, tables 13.5px, rows 36px (32px "compact" setting), controls 32px tall with `--r-sm`, focus ring as on the site.
- **Cards**: `--surface`, 1px `--line`, `--r-md`, `--shadow-1` in light and a border only in dark. Header row 44px: mono 11px uppercase label at left, count or action at right, 1px `--line` under it.
- **Tables** (Listings): sticky header on `--bg-sunk` with mono 11px uppercase labels. Columns: status pill, address (14px, 500) with "city · m²" underneath in `--muted`, rent (mono, right-aligned, tabular), source (mono tag with 1px `--line` border, `--r-xs`), first seen (relative time, mono), last agent action (text). Hover `--hover`; selected row gets a 2px `--oranje` inset bar on the left (`box-shadow: inset 2px 0 0 var(--oranje)`). Click opens a 480px right drawer that slides in with `--ease-in-out` over `--dur-base`.
- **Drawer (listing detail)**: facts block (rent, size, area, available from), the match reasons as mono chips ("rent ≤ €1,200", "Utrecht Oost"), the conversation thread (landlord bubbles on `--surface` left, sent messages on a 10% `--st-contacted` tint right, timestamps mono), then actions.
- **Status pills**: the recipe above. The state machine and its colours: Found (`--st-found`) then either Skipped (`--st-closed`) or Sent (`--st-contacted`); a reply moves it to Needs you (`--st-needs-you`) or Closed; an accepted viewing becomes Viewing (`--st-viewing`); failures are Error (`--st-error`). Pills for states that are "in progress" (Checking, Sending) use the pulsing live dot instead of the static one.
- **Buttons** in the app: 32px, `--r-sm`, 13.5px wght 600. Primary is ink on paper (`--text` background, `--bg` text), not the gradient; the gradient stays reserved for the site's primary CTA and the inbox badge.

### 6.3 Action inbox

- One card per item, sorted by deadline then age. Each item:
  1. A "Needs you" pill plus a deadline chip if the landlord gave one ("answer within 2 h", turns `--st-error` when overdue).
  2. One-line summary in 14.5px 600: "Landlord proposes a viewing, Thu 26 Sep 18:30".
  3. Context in mono 12.5px `--muted`: address, rent, site.
  4. The agent's drafted reply in a quote block (2px `--line-strong` left border, `--hover` background), collapsed to two lines, expandable.
  5. Actions: one primary ("Accept and send"), then "Edit draft", "Other time" or "Dismiss". Each shows its key in a small mono `kbd`.
- Item kinds: viewing proposals, document requests, questions the profile cannot answer, matches the user asked to approve before sending, and system tasks (login expired, captcha).
- Keyboard: J and K move, Enter expands, A primary action, E edit, X dismiss, S snooze. After any action an undo toast sits bottom right for 5 s.
- Empty state: `.dotgrid` background, the mark with its window lit, and "Nothing needs you. Last check 40 s ago on 2 sites."
- Announce new inbox items with one `aria-live="polite"` region ("New: viewing proposed for Oudegracht 112"). Do not announce feed lines.

### 6.4 Live feed

- Right column (360px), full height of the content area, mono 12.5px/1.55.
- Row: `time` (HH:MM:SS, `--muted`, tabular) | pill | text. Addresses and prices in the text stay mono.
- New rows insert at the top: 4px drop and fade over `--dur-base` with `--ease-out`, plus a background flash from `color-mix(in oklab, var(--oranje) 10%, transparent)` to transparent over 1.2 s.
- If the user has scrolled down, autoscroll stops and a "Jump to latest (3 new)" pill appears at the top.
- Filter chips above the list: All, Found, Sent, Replies, Errors. Day separators as mono labels on a dotted rule.
- Paused agent: the feed header reads "Paused" and the live dot turns `--st-closed`.

### 6.5 Other pages

- **Sources**: one card per site with the live dot, last check, interval, account status, the last error in mono, and "Reconnect" or "Check now".
- **Search areas (map)**: keep Leaflet; tint tiles with CSS (`.leaflet-tile-pane { filter: grayscale(1) contrast(0.9) brightness(1.05); }` in light, `invert(1) hue-rotate(180deg) grayscale(1) brightness(0.8)` in dark); polygons stroke `--oranje` 2px with a 12% fill.
- **Settings**: single column, 640px, grouped with mono section labels; message templates in a mono textarea with variable chips (`{address}`, `{rent}`).

### 6.6 Implementation note

The current client is Create React App with MUI 5. Two paths:

- Keep MUI and pass token values into `createTheme` for palette, shape and typography. MUI's colour helpers (`alpha`, `darken`) need real colours, so the values would be duplicated from `tokens.css` into a JS module; add a test that the two agree.
- Recommended: drop MUI for plain CSS (or CSS modules) that reads `tokens.css` directly. The dashboard is a handful of views, and MUI's default look pulls against this direction.

Either way, CRA refuses imports from outside `src/`, so keep the source of truth at `client/src/styles/tokens.css`, commit a copy at `site/tokens.css`, and add a CI step that fails when they differ (`cmp client/src/styles/tokens.css site/tokens.css`). The site links it as a separate stylesheet (`<link rel="stylesheet" href="tokens.css">` then `style.css`), which keeps the no-build Pages deploy and avoids an `@import` waterfall.

---

## 7. Logo

All three are drawn on a 16-unit grid so the 16px favicon is pixel-exact. Renders are in `refs/99-proof-logos-light.webp`, `refs/99-proof-logos-dark.webp`, and a 5x zoom of the 16px and 32px sizes in `refs/99-proof-logos-16px-zoom.webp`.

### A. One window (recommended)

A stepped canal-house gable (trapgevel) in solid silhouette, with a single square window cut out. In colour the window is filled `--oranje`: a lit window, a listing found.

Construction (16-unit grid): body 12 wide by 8 tall (x 2 to 14, y 7 to 15); first step 8 wide (x 4 to 12, y 4 to 7); crown 4 wide (x 6 to 10, y 1 to 4); window 3 by 3 at x 9 to 12, y 9 to 12, sitting right of centre so it reads as a window rather than a door.

```svg
<!-- Monochrome: window is a knockout, so on the gradient the gradient shows through. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
  <path fill="currentColor" fill-rule="evenodd" d="M2 15V7h2V4h2V1h4v3h2v3h2v8zM9 9h3v3H9z"/>
</svg>

<!-- Colour: the lit window. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <path fill="currentColor" fill-rule="evenodd" d="M2 15V7h2V4h2V1h4v3h2v3h2v8zM9 9h3v3H9z"/>
  <rect x="9" y="9" width="3" height="3" fill="#FF7A33"/>
</svg>

<!-- favicon.svg: flips with the browser theme. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <style>path{fill:#13201F}@media (prefers-color-scheme:dark){path{fill:#ECF1EE}}</style>
  <path fill-rule="evenodd" d="M2 15V7h2V4h2V1h4v3h2v3h2v8zM9 9h3v3H9z"/>
  <rect x="9" y="9" width="3" height="3" fill="#FF7A33"/>
</svg>
```

- 16px: crisp, every edge on a pixel boundary (checked in the zoom).
- Monochrome: works as a single fill with the knockout.
- On the gradient: ink silhouette, knockout window shows the gradient (checked on `--grad-dusk`).
- In the product the window is the agent's status light: it pulses (opacity 1 to 0.45, 2 s) while the agent runs, turns grey when paused and `--st-error` on error. Favicon can swap to a red-window variant on error.
- Clear space: 2 units on every side. Minimum size: 16px.
- Wordmark: lowercase `nl-property-finder` in Instrument Sans 600, letter-spacing -0.01em; mark height 1.3x the cap height; gap 0.45em. The mark is `aria-hidden` next to the wordmark, as on the owner's sites.
- Apple touch icon (180px): ink rounded square (`#13201F`, 40px radius), paper mark at 60% size, orange window.

### B. Facade grid

The same stepped gable built from 18 squares (2 by 2 units on a 3-unit pitch: one square in the top row, three in the second, five in each of the last three rows). The lit window is the square at (10, 7): orange in colour, left out in monochrome.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">
  <rect x="7" y="1" width="2" height="2"/>
  <rect x="4" y="4" width="2" height="2"/><rect x="7" y="4" width="2" height="2"/><rect x="10" y="4" width="2" height="2"/>
  <rect x="1" y="7" width="2" height="2"/><rect x="4" y="7" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/><rect x="13" y="7" width="2" height="2"/>
  <rect x="1" y="10" width="2" height="2"/><rect x="4" y="10" width="2" height="2"/><rect x="7" y="10" width="2" height="2"/><rect x="10" y="10" width="2" height="2"/><rect x="13" y="10" width="2" height="2"/>
  <rect x="1" y="13" width="2" height="2"/><rect x="4" y="13" width="2" height="2"/><rect x="7" y="13" width="2" height="2"/><rect x="10" y="13" width="2" height="2"/><rect x="13" y="13" width="2" height="2"/>
  <rect x="10" y="7" width="2" height="2" fill="#FF7A33"/>
</svg>
```

Strongest at 32px and above; at 16px it turns into texture (visible in the zoom). Best as the extended motif: a loading state where squares light one by one, section dividers, the OG image.

### C. Gable lens

A solid magnifier disc (centre 6.5, 6.5, radius 5.5) with a five-point gable knocked out of it, and a round-capped handle at 45 degrees.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <path fill="currentColor" fill-rule="evenodd" d="M6.5 1a5.5 5.5 0 1 0 0 11a5.5 5.5 0 0 0 0-11zM4 9.5v-3l2.5-2l2.5 2v3z"/>
  <path d="M10.6 10.6l3.9 3.9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
</svg>
```

Reads immediately as "house search", but it is the most common real-estate icon there is, and at 16px the diagonal handle and the gable knockout antialias into a blur (visible in the zoom).

### Recommendation

**A, with B as its extended motif.** A is pixel-exact at 16px, works as one colour, sits cleanly on the gradient, and carries the whole direction's idea (a lit window is a listing found). B shares its geometry, so the hero street, the loading state and the logo read as one family. C is clear but generic and weakest at favicon size.

---

## 8. Performance

Target: LCP under 1.5 s on a mid-range phone on 4G, CLS under 0.02, total transfer on first load under 250 KB before screenshots.

- **The hero is text and inline SVG.** LCP is the h1, not an image. No video, canvas or WebGL. For contrast, Lio, Crusoe, CoFounder and Edra ship hero videos, and Solais still showed a blank loader 4.5 s after navigation in this capture.
- **Every effect is CSS**: stacked radial gradients for the mesh, one 160px SVG noise tile for grain (static, only on the hero pane and OG image), `repeating-linear-gradient` for the ribs, `radial-gradient` for dot grids and the aura (no `filter: blur()` on large boxes).
- **Limit `backdrop-filter`** to three things on screen at once (nav, feed card, reeded pane), all with `@supports` fallbacks. Never on a full-width scrolling layer.
- **Animate only `transform` and `opacity`**, apart from window `fill` on small SVG rects. The hero plays once and stops. The marquee pauses when off screen (IntersectionObserver toggles `.is-offscreen`). No smooth-scroll library, no scroll-jacking, no parallax.
- **Fonts**: four self-hosted latin woff2 files (about 132 KB), `font-display: swap`, preload only the Instrument Serif regular, and a metric-matched Georgia fallback so the swap does not move the headline. If a CDN is used: preconnect to `fonts.googleapis.com` and `fonts.gstatic.com` (crossorigin).
- **No layout shift**: the nav has a fixed height; the hero pane uses `aspect-ratio`; the marquee band has a fixed height; every `img` has `width`/`height`; the reveal only uses opacity and transform.
- **Images**: screenshots as AVIF with WebP fallback via `<picture>`, light and dark pairs, `loading="lazy" decoding="async"` below the fold, sized to the largest rendered width at 2x (not 2880px when the frame is 720px wide).
- **Below the fold**: `content-visibility: auto; contain-intrinsic-size: auto 900px;` on sections 3 to 8.
- **JS**: two small modules, `theme.js` (owner's) and `main.js` (reveal, nav state, marquee pause, hero sequence), together under 5 KB, `type="module"` so they defer. No analytics, no third-party scripts.
- **Budget check** in CI (optional): Lighthouse CI on the built `site/` with performance and accessibility at 95 or above.

---

## 9. Accessibility checklist

- All text pairs pass WCAG AA (table in 4.1). `--faint` and `--brick` never carry text.
- Focus ring 2px `--focus`, offset 2px, visible on the gradient button and on dark bands.
- Site buttons at least 44px tall; dashboard targets at least 24px with 8px spacing.
- Skip link, `main` with `tabindex="-1"`, one h1, sections labelled by their h2.
- Theme button: visible label is the accessible name, state in `aria-pressed`.
- Motion: reduced-motion block; the hero shows its final frame; the marquee becomes a static list; the live dot stops pulsing.
- Marquee duplicate list is `aria-hidden="true"`; the real list is readable once.
- Dashboard: one polite live region for new inbox items only; every keyboard shortcut also has a visible button; pills keep a border in forced-colors mode.
- Alt text describes what is on screen in concrete terms (owner's pattern); decorative SVG is `aria-hidden="true" focusable="false"`.

---

## 10. File plan

```
site/
  index.html
  tokens.css          # committed copy of client/src/styles/tokens.css; CI checks they match
  style.css
  theme.js            # owner's toggle, key "nlpf-theme"
  main.js             # reveal, nav state, marquee pause, hero sequence
  fonts/              # 4 woff2 + OFL.txt
  assets/
    mark.svg  favicon.svg  favicon-32.png  apple-touch-icon.png  og.png
    shots/inbox-light.avif|webp  inbox-dark.avif|webp
.github/workflows/pages.yml   # meeting-copilot no-build variant, branches: [master],
                              # paths: site/**, .github/workflows/pages.yml
```

---

## Appendix: screenshots

All in `docs/design/refs/` (1440x900 viewport).

| File | What it shows |
|---|---|
| 01-dawn-hero.png, 01-dawn-section.png | Split inset panels with sunrise gradient; dark section with gradient arc |
| 02-lio-hero.png, 02-lio-section.png | Reeded-glass video hero, two-tone serif headline; light serif section with photo cards |
| 03-wispr-hero.png, 03-wispr-section.png | Garamond hero with italic, floating nav; deep green band with live waveform widget |
| 04-rime-hero.png, 04-rime-section.png | Dot-matrix waveform, condensed headline, logo marquee; mono pill labels, dotted rule |
| 05-cofounder-hero.png, 05-cofounder-section.png | Pixel-art hero with floating task toasts and glass nav; low-contrast product diagram |
| 06-solais-hero.png, 06-solais-section.png | 3D mark, grain, crimson gradient, technical annotations (hero retaken at 9 s) |
| 07-edra-hero.png, 07-edra-section.png | Calm serif hero, yellow dot pill; dark olive panel with tab card |
| 08-crusoe-hero.png, 08-crusoe-section.png | Mono display over video; lime band (cookie dialog overlaps the lower half) |
| 09-deepjudge-hero.png, 09-deepjudge-section.png | Big tight serif, barcode motif, dark floating nav; mono source cards with dashed links |
| 10-joyful-hero.png, 10-joyful-section.png | Soft serif hero, outlined pill eyebrow; stat cards and a card on a warm aura |
| 99-proof-light.png, 99-proof-dark.png | This direction rendered: hero pane, logo concepts, inbox and table, both themes |
| 99-proof-logos-light.png, 99-proof-logos-dark.png | The three marks at 16, 32 and 64px, on ink and on the gradient |
| 99-proof-logos-16px-zoom.png | 16px and 32px marks at 5x, nearest-neighbour |

Known gaps in the proof render: unlit windows used the old `--window-off` value (invisible on ink in light mode; fixed in the tokens above), and the h1 used `max-width: 11ch` (now 14ch).
