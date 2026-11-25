# giftwrap: implementation proposal

Status: draft for review, 2026-11-25. No app code exists yet.

## Summary

- **Stack:** Vite, TypeScript and three.js (`WebGLRenderer`). No UI framework, no backend, no runtime assets from other hosts.
- **Physics:** one small solver of our own (XPBD, position-based dynamics) for paper, ribbon, ornaments, box and lid. A spike showed the paper part is stable and cheap.
- **Paper:** pre-scored shards held together by breakable seams and lightly glued to the box. It tears along jagged lines without changing the mesh at runtime.
- **Links:** everything goes in the URL fragment, `/open/#<payload>`, as packed bytes in base64url. A typical gift is about 206 characters of payload.
- **Biggest unknowns:** phone performance, and the bow knot. Milestone 1 tests both before anything else is built.

## Pages

### Wrap (`/`)

Live 3D gift plus form. Side by side on desktop, gift above form on mobile.

| Element | Detail |
| --- | --- |
| Fields | From, To, Gift, Code, Image URL. All optional. |
| Paper | Pattern swatches, two colours, scale, finish (matte, gloss, foil) |
| Ribbon | Bow style, width, colour, finish |
| Shuffle | Dice icon, randomises paper and ribbon |
| Create | Produces the link with copy, share and open icons |

Patterns are drawn in code to a canvas texture: snowflake, candy stripe, plaid, pine, star, dot, holly, plain. Every change shows on the model immediately. An image URL that fails to load is flagged next to its field.

### Unwrap (`/open/`)

A wrapped box half-sunk in a pile of glass ornaments, at night, in light snow. To and From appear on a tag attached to the gift.

1. **Ribbon:** pull a bow tail. The knot slips and the ribbon falls away.
2. **Paper:** grab and tear anywhere.
3. **Lid:** lifts once the paper is off. Ornaments and light burst out.
4. **Reveal:** title, image and code, showing only the fields that were filled in. The code has a copy icon that changes to a check.

Pressing the gift grabs it; dragging the background orbits. Near the end, or after about 12 pulls, the remaining glue lets go, so nobody gets stuck on the last scrap.

### Words

The only visible text is the field names, `Create`, what the sender typed, and short errors. The title is `giftwrap`. Icon buttons carry hidden accessible names.

### Celebration

Both moments get one (decided 2026-11-25):

- **On unwrap (main):** lid pop, ornament burst, gold confetti, snow flurry, a star flaring above the box.
- **On Create (small):** the ribbon cinches, the bow springs open, a short sparkle.

## Physics

### Options

| Option | Download (gzip) | For | Against |
| --- | --- | --- | --- |
| **Own XPBD solver (chosen)** | under 15 KB (estimate) | Tearing built for this effect; measured in a spike | We write box and lid contacts ourselves |
| Rapier 0.21 | 1.15-1.17 MB wasm | Cloth, creasing, tearing and rigid bodies in one engine | Soft bodies are two months old; performance not measured; about 5x the size of everything else |
| Rapier 0.19 + own cloth | 834 KB | Mature rigid bodies | Two solvers to couple by hand |
| Jolt 1.1.2 | 746 KB wasm | Strong engine | Large, and tearing not evaluated |
| cannon-es 0.20 | 75 KB (unminified) | Small | Last published in 2022; no tearing |

The current `@react-three/rapier` (2.2.0) pins Rapier 0.19.2, so it does not expose the new soft bodies.

The reference ball pit (React Bits) also uses no engine: it has its own sphere solver and raw WebGL2, with 200 balls by default. We take the feel (glossy balls, cursor as a collider, grab and throw), not the code. Its licence was not checked.

### Model

- **Paper:** 12x12 grid per face, about 1,400 vertices. Stretch and bend constraints inside about 20 irregular shards. Coincident vertices on either side of a seam are joined by a constraint that breaks under strain. Front face patterned, back face white.
- **Glue:** about 8% of vertices stick to the box until pulled past a threshold.
- **Grab:** a hand-sized patch with a capped pull, not a single vertex.
- **Ribbon:** two strip loops plus a bow. The knot is a breakable constraint that releases when a tail is pulled far enough.
- **Rigid:** ornaments as spheres in a spatial hash; box and lid as oriented boxes.
- **Stepping:** fixed 60 Hz, 8 substeps, on the main thread.

Two-sheet self-collision is skipped. Crumpled shards can pass through each other.

### What the spike measured

Throwaway Node script, our own code, Apple M5 Pro, 120 balls, 8 substeps. Automated drags until about 90% of the paper was off.

| Setup | Drags | Edges stretched >10% | Physics per frame |
| --- | --- | --- | --- |
| 60 shards, single-point grab | 39 | 0.04% (worst edge 67%) | 0.7-1.0 ms |
| 20 shards, hand-sized capped grab, 3 passes | **7** | 0.08% (worst edge 40%) | 1.4 ms, p95 2.6 |
| Low-detail mesh (8x8 faces, 80 balls, first grab) | 33 | worst edge 32% | 0.3 ms |

It stayed stable: no invalid coordinates in any run, and no seams broke in an idle second with the first setup (idle was only checked there).

What it did **not** show:

- Any phone. A phone 8x slower would need about 11 ms, over the 4 ms budget, so the low-detail mesh is the planned mobile tier.
- Rapier 0.21 speed.
- Bow knot, tumbling box, lid, or real touch input.
- How it looks; frames were flat-shaded debug drawings.

Results are sensitive to tuning: raising the seam strength from 0.035 to 0.06 took 7 drags to 24.

## Rendering

- `WebGLRenderer`, about 195 KB gzip before tree-shaking (three 0.187 measured). The WebGPU build is about 229 KB. Its WebGL2 fallback has no compute, which is the main thing it would offer us.
- Clearcoat physical materials, lighting generated at runtime, no downloaded models or HDRs.
- Ornaments and confetti instanced. Pixel ratio capped at 2, dropping to 1.5 and fewer balls when frames run long.

## Link format

```
/open/#<base64url( version | field mask | style bytes | fields | checksum )>
```

Strings are UTF-8 with a length prefix. Style is about 12 bytes. Measured payload lengths in characters, without the checksum:

| Gift | JSON | JSON + deflate | Packed (chosen) | Packed + deflate |
| --- | --- | --- | --- | --- |
| Empty | 146 | 102 | **19** | 22 |
| Names only | 155 | 116 | **31** | 34 |
| Typical | 326 | 260 | **206** | 203 |
| Unicode | 271 | 243 | **151** | 155 |
| Long image URL | 540 | 435 | **422** | 376 |

Compression only helps long image URLs, so there is none.

- **Fragment, not query:** browsers do not send it to the server or include it in `Referer`, so gift codes stay out of host logs.
- **Not secret:** anyone with the link can decode the code. It is encoding, not encryption.
- **Previews:** chat apps will show one generic preview, since crawlers never see the fragment.
- **Length:** total link capped at 2,000 characters. Chrome documents 2 MB; no reliable messaging-app limit was found, so this is deliberately conservative.
- **Versioned:** links must keep working, so old versions stay decodable. The checksum catches truncated links, which show a short error.

## Safety

- Gift text is inserted as text only, never HTML, and never turned into links.
- Image URLs must be `https:`. The image is an `<img>` beside the canvas, not a WebGL texture, because many image hosts do not allow cross-origin textures. `referrerpolicy="no-referrer"`.
- Loading the image shows the recipient's IP to whoever hosts it. That follows from accepting any image URL.
- Content Security Policy in a meta tag; no analytics.

## Mobile and accessibility

- Pointer events throughout; `touch-action: none` on the canvas only.
- Space or Enter tears the next piece; the reveal is announced to screen readers.
- `prefers-reduced-motion`: no burst, gift opens with a fade.
- Without WebGL: a flat wrapped card that opens on tap.
- Copy uses `navigator.clipboard`, which needs HTTPS, with a select-and-copy fallback.

## Layout

```
index.html            wrap page
open/index.html       unwrap page
src/codec/            link encode and decode (no DOM)
src/sim/              physics (no DOM, no three.js)
src/scene/            rendering, materials, patterns, celebration
src/wrap/  src/open/  page code
```

Keeping `sim` and `codec` free of the DOM lets them run in Node tests.

## Testing

- **Codec:** round trips, random input, truncation, unknown versions.
- **Physics:** scripted drags in Node, as in the spike: no invalid values, unwraps within a drag limit.
- **Pages:** Playwright on Chromium and WebKit at phone and desktop sizes.
- **By hand:** one iPhone and one mid-range Android.

## Milestones

| # | Work | Done when |
| --- | --- | --- |
| 1 | Tearing, bow and box on real phones | 60 fps on both phones, 10 or fewer pulls to unwrap, bow unties reliably |
| 2 | Link codec and both pages end to end | A created link opens the same gift |
| 3 | Paper and ribbon options | Every option previews live and survives the link |
| 4 | Celebrations, scene, accessibility | Full flow on phone and desktop |
| 5 | Tests and deploy | Live on GitHub Pages |

If milestone 1 misses on phones, the order of fallbacks is: low-detail mesh, physics in a worker, then Rapier.

## Decisions

Made:

- **Physics (2026-11-25):** our own XPBD solver. Rapier 0.21 is not benchmarked now; it stays the last fallback if milestone 1 misses on phones.
- **Celebration (2026-11-25):** both: a full one on unwrap and a small one on Create.
- **Hosting (2026-11-25):** GitHub Pages, deployed by a GitHub Actions workflow on push to `main`.

Nothing is open.

## Hosting notes (GitHub Pages)

- A project site is served from a subpath (`<user>.github.io/giftwrap/`), so the build uses relative asset paths and links are built from the page's own location, never a hard-coded origin. The same build then works on a custom domain.
- Pages serves HTTPS, which the clipboard API needs.
- Pages cannot set custom response headers, so the Content Security Policy goes in a meta tag, as planned.
- `/open/` is a real `open/index.html`, so no SPA redirect tricks are needed.
- There is no GitHub remote yet. Creating the repository and turning on Pages is for you to do, or for me once you say so.

## Sources

- [Rapier README](https://github.com/dimforge/rapier/blob/master/README.md), [Rapier 0.21.0 package](https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/) (type definitions read directly)
- [React Bits Ballpit source](https://raw.githubusercontent.com/DavidHDev/react-bits/main/src/content/Backgrounds/Ballpit/Ballpit.jsx)
- [three.js forum: WebGPU fallback](https://discourse.threejs.org/t/r3f-webgpu-webgl2-fallback-tree-shaking/87188) (the three.js manual page could not be fetched)
- [XPBD](https://matthias-research.github.io/pages/publications/XPBD.pdf), [Small Steps in Physics Simulation](https://diglib.eg.org/handle/10.1145/3309486-3340247), [PBD rigid bodies](https://matthias-research.github.io/pages/publications/PBDBodies.pdf) (read as search summaries)
- [MDN: URI fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment), [MDN: Referer](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer), [MDN: clipboard.writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)
- [Chromium URL guidelines](https://chromium.googlesource.com/chromium/src/+/main/docs/security/url_display_guidelines/url_display_guidelines.md)
- Package sizes: measured from jsDelivr with `gzip -9` on 2026-11-25
