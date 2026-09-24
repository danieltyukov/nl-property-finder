# Third-party notices

nl-property-finder is released under the MIT licence (see `LICENSE`). This file
lists the third-party components that the project site (`site/`) and the shared
design package (`packages/design/`) ship to a visitor's browser, with their
licences. Every other dependency is installed from npm under its own licence,
recorded in `package-lock.json`.

## GSAP 3.15

- Used by: the project site's text motion (`site/src/motion.ts`): GSAP core,
  SplitText and ScrambleTextPlugin.
- Licence: the GSAP Standard "no charge" License,
  https://gsap.com/standard-license. GSAP is not MIT licensed.
- Copyright 2008-2026, GreenSock. All rights reserved.
- How it is included: installed from npm as `gsap` and bundled into the site's
  build. It is not copied into this repository. The build keeps GSAP's
  `@license` headers in the bundle (`site/vite.config.ts`, `comments.legal`).
- The licence allows commercial and non-commercial use at no charge. It does not
  allow using GSAP in a tool that lets people build visual animations without
  code in competition with Webflow's own builder, which this project does not
  do.

## three.js r186

- Used by: the project site's 3D scene (`site/src/stage/`).
- Licence: MIT.

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Fonts

Self-hosted Latin subsets in `packages/design/fonts/`, each under the SIL Open
Font License 1.1. The full licence text is in `packages/design/fonts/OFL.txt`.

- Instrument Serif: Copyright 2022 The Instrument Serif Project Authors
  (https://github.com/Instrument/instrument-serif)
- Instrument Sans: Copyright 2022 The Instrument Sans Project Authors
  (https://github.com/Instrument/instrument-sans)
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono)
