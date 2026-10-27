# ASCII 3D rendering tech for web

Research ticket: [ASCII 3D rendering tech for web](https://github.com/jmcada2503/webTypingGame/issues/2). Researched 2026-10-26.

**Question.** Which rendering approach gives the reference ASCII-3D look in the browser: white-on-black monospace characters shaded by a luminance ramp like ` .,-~:;=!*#$@`? Readable text has to sit in the same character grid, including the Cockpit screens (Lives, Typed word, red Attack word) and Word bullets that grow as they approach.

## Answer (TL;DR)

- **Recommend:** **three.js `WebGLRenderer` (WebGL2) + our own 3-pass GLSL ASCII pipeline.** The passes are scene → per-cell classify → glyph composite. Glyphs come from a glyph atlas built at runtime from a canvas. Edge glyphs (`| - / \`) come from Sobel on depth and normals.
  - **Grid-locked text** for the Cockpit screens (Lives, Typed word, Attack word) is written by the CPU into a per-cell overlay `DataTexture`. It uses the same atlas and font, so it is pixel-identical to the shaded cells.
  - **Word bullets** are SDF text meshes (`troika-three-text`) drawn *after* the ASCII pass with the same camera. They stay crisp at every size, grow smoothly with perspective, and the typed prefix can be colored green. A black halo plus knocked-out cells behind each word keep it legible.
- **Fallback:** **CPU cell rasterizer → 2D canvas.** We project and rasterize the same three.js geometry ourselves into a cell grid (z-buffer, luminance → ramp, edge glyph from normal/depth jumps). Glyphs are blitted from the same atlas with `drawImage`, and Word bullets are drawn with `fillText` at any size. Both backends sit behind the same render-layer interfaces, so swapping is local.
- **Not recommended for the game:** three.js `AsciiEffect` and pmndrs `ASCIIEffect`. Use them only as one-hour "look references" in the sandbox. `AsciiEffect` reads every frame back to the CPU and rebuilds DOM HTML. Neither has edges, a text overlay, or per-cell semantic color.

## Comparison

Legend: ✅ good · ⚠️ workable with effort or caveats · ❌ poor

| Approach | Fidelity to reference (ramp + edge chars) | 60 fps fixed canvas, Chrome + Safari | Per-character color | Crisp text in grid + smooth-growing words | TS + Vite, OO fit | Verdict |
|---|---|---|---|---|---|---|
| **three.js `AsciiEffect`** (r186, `examples/jsm/effects/AsciiEffect.js`) | ⚠️ Luminance only, any charset. No edges. Samples every *other* row (`y += 2`). | ⚠️/❌ Every frame it draws the WebGL canvas into a 2D canvas, calls `getImageData` (GPU→CPU readback), builds an HTML string and replaces a `<table>`'s `innerHTML`. The source itself says color mode "slows down rendering". | ❌ Only one `<span style="color:rgb()">` per cell, taken from scene color, not semantic. | ⚠️ DOM text is crisp, but there is no API to inject text into the grid; we would have to patch the string builder. Smooth scaling would need separate DOM elements. | ✅ Drop-in, typed through `@types/three`. | Look reference only |
| **pmndrs `postprocessing` `ASCIIEffect`** (v6.39.5, peer `three >=0.168 <0.187`) | ⚠️ GPU luminance → glyph from `ASCIITexture` (canvas atlas: Arial, 54 px, 16×16 cells on 1024², default chars ``" .:,'-^=*+?!\|0#X%WM@"``). One sample per cell. No edges. | ✅ Full GPU. | ⚠️ One `color` uniform, or scene color. | ❌ No overlay. Text rendered in the scene gets ASCII-fied too. | ✅ TS-friendly, but its `EffectComposer` is separate from three's. | Look reference only |
| drei `AsciiRenderer` / react-postprocessing `ASCII` | Same as the two above (they wrap them) | Same | Same | Same | ❌ Needs React + R3F, which are not in our stack | Skip |
| **Custom GPU post-process (three.js WebGL2 + GLSL)** | ✅ Exact ramp. Edge glyphs via Sobel + per-cell vote (Acerola's method). Optional shape-aware upgrade later (Harri, Lunardi). | ✅ A few fullscreen passes on a 160×45 grid is trivial GPU work. WebGL2 is in Safari 15+ and Chrome 56+ (~97% global). | ✅ Palette index per cell, from the overlay or material hue. | ✅ Grid text: CPU-written overlay texture, same atlas → identical crispness. Smooth words: SDF text meshes after the ASCII pass. | ✅ Small classes (`GlyphAtlas`, `AsciiPipeline`, `CellOverlay`, `WordLayer`) around three.js objects. GLSL as `?raw` imports in Vite. | **Recommended** |
| **CPU rasterizer → 2D canvas** | ✅ Exact ramp (donut.c style). Edge glyphs from per-cell normal/depth discontinuities. Total control. | ⚠️ Rasterizing low-poly primitives at cell resolution is cheap in JS. The risk is the output: ~7k glyph draws per frame. `drawImage` from an atlas is much faster than `fillText` per cell (VS Code / xterm.js experience). *Unmeasured on Safari.* | ✅ Trivial: a color per cell. | ✅ Grid text is trivial (write into cells). Smooth words: `fillText` at any size on the same canvas. | ✅ Plain TS, easiest to unit-test. We write the projection, clipping and z-buffer ourselves (~300–500 lines); three.js can still provide geometry and math. | **Fallback** |
| CPU-raster cells → WebGL glyph blit (hybrid) | ✅ Same as the CPU path | ✅ Removes the 2D-canvas output risk (this is how xterm.js's WebGL2 renderer works) | ✅ | ✅ | ✅ | Escape hatch if the fallback's 2D-canvas output is too slow |
| Shape-aware ASCII (Alex Harri, Jan 2026; Codrops/Lunardi, Sep 2026, three.js) | ✅✅ Sharpest edges: each cell is matched against 95 glyph "shape vectors" (6 sampling circles plus neighbors). But it drifts from the pure-ramp reference look. | ⚠️ GPU only. Harri's CPU prototype ran "single-digit FPS on my iPhone". Extra passes. | ✅ | Same as the custom GPU path | ⚠️ More shader complexity | Later upgrade, not v1 |
| play.core (ertdfgcvb, Apache-2.0) | n/a (2D text-mode playground, no 3D) | ⚠️ Canvas renderer calls `fillText` per cell | ✅ | ✅ | ⚠️ JS, its own runtime loop | API inspiration for the CPU path only |
| Babylon.js `AsciiArtPostProcess` | ⚠️ Luminance only | ✅ | ⚠️ | ❌ | ❌ Different engine | Skip |

Notes on WebGPU: Safari 26.0 (2025-09-15) ships WebGPU on macOS, iOS, iPadOS and visionOS, and Safari 26 runs on macOS Sonoma, Sequoia and Tahoe. three.js `WebGPURenderer` falls back to WebGL2 automatically. This workload doesn't need WebGPU: no compute, a tiny grid. GLSL plus `WebGLRenderer` keeps the shaders simple and `troika-three-text` compatible (its README doesn't mention `WebGPURenderer`). Porting the 3 passes to TSL later is a contained job.

## Why the custom GPU pipeline wins

1. **Fidelity.** We choose the ramp, the shading curve and the edge rule. Edge glyphs are Acerola's proven method: Sobel → angle quantized to vertical / horizontal / two diagonals → vote per cell → edge glyph if enough pixels agree, else the ramp glyph. Acerola uses an 8×8 tile with a threshold. We have real depth and normals, so silhouettes and creases come out cleaner than DoG on luminance.
2. **Performance headroom.** Everything stays on the GPU and nothing is read back. The per-cell vote that Acerola does with compute-shader `groupshared` memory becomes a cell-resolution fragment pass that loops over the cell's texels in WebGL2. That is ~7.2k cells × 128 fetches ≈ 0.9 M texel reads per frame, which is negligible.
3. **Text is first-class, not an afterthought.**
   - The Cockpit is first-person and fixed to the camera, so its screens map to fixed cell rectangles. The CPU writes Lives, Typed word and Attack word as glyph and palette indices into an overlay texture. It's the same atlas and the same device-pixel cell, so the text is exactly as crisp as the shading and perfectly aligned.
   - Word bullets must *grow smoothly*, which by definition breaks a fixed grid. Rendering them as SDF text in a pass after the ASCII pass gives smooth perspective growth with no resampling blur. It uses the same monospace font, per-range color for the green typed prefix, and an outline halo.
4. **Ecosystem.** three.js gives us primitives (`BoxGeometry`, `ConeGeometry`, ...), cameras, lights and `GLTFLoader` later for free. `@types/three` tracks releases. The CPU fallback can consume the very same `BufferGeometry` and camera matrices.

## Fallback: CPU cell rasterizer

Switch to the fallback if the GPU pipeline can't produce the look: for example, edge glyphs look noisy at our cell size, or we want exact per-cell logic the shader makes awkward. Also switch if we hit Safari WebGL issues.

- Traverse the three.js scene, transform vertices with the camera's matrices, and rasterize triangles into a buffer at cell resolution or 2×2 per cell, with a z-buffer. Shade with N·L like donut.c and map to the ramp. Pick an edge glyph where the per-cell depth or normal jumps.
- Output: one `drawImage` per non-space cell from the same `GlyphAtlas` canvas, and `fillText` for Word bullets at any size. If 2D-canvas output proves too slow on Safari, upload the cell grid as a texture and reuse the GPU composite pass (the hybrid row in the table).
- Same interfaces as the primary, so the debug sandbox can toggle backends side by side.

## Starting parameters for the cube prototype

These are for the [ASCII aesthetic: rotating cube](https://github.com/jmcada2503/webTypingGame/issues/3) prototype, which locks the final values.

| Parameter | Start value | Try also / notes |
|---|---|---|
| Canvas | 1280×720 CSS px, fixed; `renderer.setPixelRatio(devicePixelRatio)` | Pick cell sizes that divide 1280×720 exactly |
| Cell | **8×16 CSS px → 160×45 grid** | 10×20 → 128×36 (bigger, more legible); check the Enemy ship still reads at 8×16 |
| Font | **JetBrains Mono 400** via `@fontsource/jetbrains-mono` 5.3.0 (OFL-1.1); size ≈ cellW / 0.6 → **13 px** for 8 px cells | IBM Plex Mono (`@fontsource/ibm-plex-mono` 5.3.0). **`await document.fonts.load('13px "JetBrains Mono"')` before building the atlas**, or the atlas silently uses a fallback font |
| Ramp | `" .,-~:;=!*#$@"`: 13 levels, space = background (the donut.c ramp) | 10-level ` .:-=+*#%@` (three.js example) to compare density |
| Luminance → index | `L = dot(rgb, vec3(0.2126,0.7152,0.0722))`; `L' = clamp(pow(L*exposure, gamma))`; `idx = floor(L' * 12.999)`; exposure 1.0, gamma 1.0 | Tune gamma 0.8–1.4 in the sandbox. The cell value is the average over the cell, not the center sample (avoids aliasing) |
| Lighting / materials | `MeshLambertMaterial({ color: 0xffffff, flatShading: true })`; one `DirectionalLight(1.0)` from upper-left-front; `AmbientLight(0.08)` so shadowed faces read as `.`/`,` | `MeshStandardMaterial` if speculars help |
| Scene render target | 1280×720 (CSS res, *not* DPR) RGBA8 + `DepthTexture`; second render with `scene.overrideMaterial = new MeshNormalMaterial()` for view normals | MRT (`WebGLRenderTarget({ count: 2 })`, supported in r186) once materials are custom |
| Edge glyphs | Sobel on depth (silhouettes) + normals (creases); 4 bins → `\|` `-` `/` `\`; edge if ≥ **12 of 128** cell px (~10%) agree | Use `_` instead of `-` for bottom-facing silhouettes; a sandbox toggle for edges on/off/debug-color (as Acerola does) |
| Cell pass output | 160×45 RGBA8 RT: R = glyph index, G = palette index | |
| Overlay | `DataTexture` 160×45 RGBA8, `NearestFilter`: R = glyph index (0 = transparent), G = palette index, B = flags (bit0 = knock-out to blank); `needsUpdate` only when dirty | |
| Glyph atlas | Printable ASCII 0x20–0x7E (95 glyphs; covers the ramp) **+ `ñ`** (words are Spanish lowercase + `ñ`; add `áéíóúü` too if the word list ever has them). JetBrains Mono covers Latin-1. Each slot `round(8·DPR)×round(16·DPR)` device px; white on transparent; `CanvasTexture`, `NearestFilter`, `generateMipmaps = false` | Composite in device pixels via `gl_FragCoord` so atlas texels map 1:1 → crisp |
| Palette | bg `#000000`, fg `#FFFFFF`, red `#FF3B30` (Attack word, damage), green `#34C759` (Typed-word prefix) | Placeholders; dim fg to `#E0E0E0` if pure white glares |
| Word bullets | `troika-three-text` 0.52.5 (peer `three >=0.125`), font = JetBrains Mono **`.woff`/`.ttf` (troika does not support `.woff2`)**; separate overlay scene rendered after the composite with the same camera; black `outlineWidth` ≈ `'12%'`; `styleRanges` → green typed prefix; also mark overlay knock-out cells under the word's projected bounds | Grid-snapped alternative to A/B: snap position to cells and grow in integer cell steps (crisper, but steppy) |
| Versions | `three` 0.186.1 (2026-09-24), `@types/three` 0.186.0, `troika-three-text` 0.52.5, `vite` ^8.3 + `typescript` ~6.0 (current `create-vite` vanilla-ts template). npm `typescript@latest` is 7.0.2 | No dependency on `postprocessing`. Optionally install it in the sandbox only, as a look reference |
| Budget check | Measure on Chrome and Safari (latest) with the three.js `Stats` panel; target ≤ 4 ms GPU for all ASCII passes at 1280×720 @2× | Perf figures in this doc are reasoned estimates, not measured |

### Pipeline sketch (per frame)

```
1. scene pass     scene → sceneRT (lit color + depth); overrideMaterial=normals → normalRT
2. cell pass      160×45 target: per cell average luminance + Sobel(depth,normal) vote
                  → glyph index (edge glyph or ramp glyph), palette index (hue → red/green/white)
3. composite      full canvas @DPR: per pixel → cell; overlay cell wins if set, knock-out blanks;
                  sample atlas[glyph] × palette[color] on black
4. word layer     overlayScene (troika Text meshes, same camera) rendered on top, no depth test
```

### OO shape (sketch, for the later render-layer work)

- `GlyphAtlas`: built from `{ font, cellW, cellH, dpr, charset }`, exposes `indexOf(char)` and `texture`.
- `CellOverlay`: CPU grid of `{ glyph, color, flags }` with `write(col,row,text,color)`, `fillRect`, `clear`, backed by a `DataTexture`.
- `WordLayer`: owns the free-scaling text sprites (Word bullets) with `setText`, `setHighlight(prefixLen)` and world position.
- `AsciiRenderer` interface: `render(scene, camera, overlay, words)`. Implemented by `GpuAsciiRenderer` (primary) and `CpuAsciiRenderer` (fallback). The debug sandbox can switch between them and expose cell size, ramp, gamma and edge threshold as live knobs.

## Uncertainties / to validate in the prototype

- **Performance numbers are reasoned, not benchmarked.** Measure the GPU pipeline in Chrome and Safari early. For the fallback, measure ~7k `drawImage` calls per frame in Safari before relying on it.
- **Smooth-growing words vs. grid purity is a design call.** SDF text after the ASCII pass is legible and smooth but not grid-aligned. Look at it next to the grid-snapped variant in the sandbox before locking it.
- `troika-three-text` with `WebGPURenderer` is unverified. That's one more reason to start on `WebGLRenderer`.
- The Codrops shape-aware article was readable only via search summaries (the site returned 403 to the fetcher). Its details are second-hand.
- Edge-glyph quality at 8×16 cells with 128 px votes is untested. Acerola tuned for 8×8 tiles.

## Sources

- three.js `AsciiEffect` source (r186 / dev): https://github.com/mrdoob/three.js/blob/dev/examples/jsm/effects/AsciiEffect.js; example: https://threejs.org/examples/webgl_effects_ascii.html
- three.js `WebGPURenderer` docs (WebGL2 fallback): https://github.com/mrdoob/three.js/blob/r186/docs/pages/WebGPURenderer.html.md; `RenderTarget` `count` (MRT): https://github.com/mrdoob/three.js/blob/r186/src/core/RenderTarget.js
- three.js npm versions (0.186.1, 2026-09-24): https://www.npmjs.com/package/three
- pmndrs postprocessing `ASCIIEffect` / `ASCIITexture` (v6.39.5): https://github.com/pmndrs/postprocessing/blob/main/src/effects/ASCIIEffect.js, https://github.com/pmndrs/postprocessing/blob/main/src/textures/ASCIITexture.js
- react-postprocessing ASCII: https://react-postprocessing.docs.pmnd.rs/effects/ascii; drei `AsciiRenderer` (wraps `AsciiEffect`): https://github.com/pmndrs/drei/blob/master/src/core/AsciiRenderer.tsx
- Acerola (Garrett Gunnell) ASCII shader, MIT, Unity (DoG → Sobel → angle bins → per-tile vote): https://github.com/GarrettGunnell/Post-Processing/tree/main/Assets/ASCII
- Alex Harri, "ASCII characters are not pixels: a deep dive into ASCII rendering" (2026-01-17): https://alexharri.com/blog/ascii-rendering
- Edoardo Lunardi, "Beyond the Luminance Ramp: A Shape-Aware ASCII Renderer in Three.js", Codrops (2026-09-04): https://tympanus.net/codrops/2026/09/04/beyond-the-luminance-ramp-a-shape-aware-ascii-renderer-in-three-js/
- a1k0n, "Donut math: how donut.c works" (2011-07-20), the ramp `.,-~:;=!*#$@`: https://www.a1k0n.net/2011/07/20/donut-math.html
- WebKit, "WebKit Features in Safari 26.0" (2025-09-15), WebGPU shipping: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- Can I use, WebGL 2.0 (Safari 15+, Chrome 56+): https://caniuse.com/webgl2
- VS Code, "Integrated Terminal Performance Improvements" (2017), texture atlas vs `fillText`: https://code.visualstudio.com/blogs/2017/10/03/terminal-renderer; xterm.js 5.1.0 atlas notes: https://github.com/xtermjs/xterm.js/discussions/4334
- troika-three-text README (SDF, runtime glyphs, no `.woff2`, `styleRanges`, outline): https://github.com/protectwise/troika/blob/main/packages/troika-three-text/README.md
- play.core canvas renderer: https://github.com/ertdfgcvb/play.core/blob/master/src/core/canvasrenderer.js
- Babylon.js ASCII art post-process: https://github.com/BabylonJS/Babylon.js/tree/master/packages/dev/postProcesses/src/asciiArt
- MDN `FontFaceSet.load()`: https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load
- create-vite vanilla-ts template (TS ~6.0.3, Vite ^8.3.4): https://github.com/vitejs/vite/blob/main/packages/create-vite/template-vanilla-ts/package.json
