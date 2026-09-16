# Cold-loading results

Measured locally on September 15, 2026, with production Vite builds, gzip responses,
fresh Lighthouse browser profiles, and real DevTools network throttling. These are
local comparisons, not measurements of a newly deployed GitHub Pages site.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Runtime GLB, gzip | 11.829 MB | 4.552 MB | 61.5% smaller |
| Runtime GLB, uncompressed HTTP body | 13.604 MB | 6.119 MB | 55.0% smaller |
| Complete 3D reveal, 10 Mbps / 40 ms / desktop CPU | 10.54 s | 4.20 s | 60.1% faster |
| Complete 3D reveal, 1.6 Mbps / 150 ms / 4× CPU slowdown | 59.75 s | 24.15 s | 59.6% faster |
| Meshes | 317 | 21 | 93.4% fewer |
| Shadow-casting meshes | 199 | 17 | 91.5% fewer |
| Triangles | 623,296 | 623,296 | Preserved |
| Three.js vendor bundle, gzip | 163.60 KB | 163.60 KB | Unchanged |

The new transparent WebP poster is 54.8 KB. Its request finished at 0.13 s in the
10 Mbps run and 1.11 s in the slow-mobile run. Those are download timings, not paint
timings. The first captured filmstrip frames already show the poster at 0.53 s and
3.02 s respectively. The poster stays visible until the full model is prepared.

## Measurement details

The readiness metric is a User Timing measure named `hibiscus-ready`, recorded
after shader compilation and the initial render. The baseline build uses a
MutationObserver on the original loader's `loaded` class, which changes immediately
after the same work. The measure records the application reveal point, not a GPU
fence or a separately measured display scanout.

Lighthouse's generic FCP, LCP, and interactive estimates can describe this viewer's
small HTML controls instead of its asynchronous WebGL model. They are not used as
substitutes for complete 3D readiness. The transparent poster was not selected as
LCP in the final run; its network timing and filmstrip are reported separately.

Final per-profile results are single controlled runs. Earlier candidate runs were
4.94 s desktop and 23.96 s mobile; the desktop candidate run overlapped the KTX
encoder, so the final desktop run was repeated after encoding ended. Absolute times
vary with hardware, GPU, latency, and network conditions. Mobile is desktop Chrome
with a mobile viewport and CPU throttling, not a physical phone.

Raw Lighthouse JSON and screenshots are in ignored `artifacts/loading-before/`
and `artifacts/loading-after/`. The final JSON files are `final-10mbps.json` and
`final-mobile.json`; baseline files are `cold-10mbps.json` and `cold-mobile.json`.
The retained baseline build is `artifacts/loading-before/dist/`.

## Implementation and validation

- Regenerate the runtime asset from the untouched `project-files/hibiscus.glb` using
  `npm run optimize:model`: 1024-pixel maximum textures, WebP quality 80, material
  palettes, semantic-group-aware joining, and Meshopt. No geometry simplification.
- Joining preserves explicit `controlGroup` and `shadowCaster` metadata. The extra
  two meshes versus the earlier 19-mesh candidate retain separate foliage and
  shadow boundaries instead of merging solely by material.
- `npm run check:model` verifies triangle totals separately for flower (438,240),
  foliage (133,216), and dew (51,840), and bounds within quantization tolerance.
- Major petals, leaf blades, throat, and sepals cast shadows. Shadow maps update
  after foliage/wireframe changes, rather than on every camera frame.
- Frustum culling is enabled. Authored sidedness is respected; this source already
  marks its materials double-sided, so removing the override alone gives no saving.
- Idle views no longer issue continuous renders. Orbit damping, camera transitions,
  rotation, resizing, visibility controls, wireframe, and exposure request redraws.
- `preserveDrawingBuffer` is removed. Save image synchronously copies the freshly
  rendered canvas before encoding the PNG. This keeps the exact on-screen color
  pipeline and avoids a persistent buffer or screenshot-specific shaders.
- `npm run build` and geometry checks passed. Browser checks covered desktop and
  390×844 mobile layouts, portrait/macro/side/reverse views, foliage/dew controls,
  wireframe, and PNG generation; no browser warnings/errors were observed. PNG
  pixels were inspected directly because the in-app download-event hook timed out.
- Texture compression is lossy: fine vein detail is somewhat softer at macro scale.
  Flower shape, pollen geometry, and leaf geometry remain intact. The source assets
  are preserved for future quality adjustments.

## KTX2 normal-map experiment

The role-specific experiment used PNG normal maps resized from the original source,
Khronos KTX Software 4.4.2, UASTC level 4, RDO lambda 0.5, Zstandard level 18, then
Meshopt for geometry. Color textures remained WebP.

Result: **16.93 MB GLB / 15.22 MB gzip**, versus **6.12 MB / 4.55 MB** for the selected
WebP asset. This high-quality normal-map candidate failed the cold-transfer goal,
so it was not integrated into the runtime or benchmarked for GPU upload speed. This
is one UASTC setting, not a claim that every KTX2 encoding is larger.

Reproduce the experimental input with:

```sh
KTX_EXPERIMENT=1 npm run optimize:model -- /tmp/hibiscus-ktx-input.glb
npx @gltf-transform/cli@4.5.0 uastc /tmp/hibiscus-ktx-input.glb /tmp/hibiscus-ktx.glb --slots normalTexture --level 4 --rdo --rdo-lambda 0.5 --zstd 18
npx @gltf-transform/cli@4.5.0 meshopt /tmp/hibiscus-ktx.glb /tmp/hibiscus-ktx-meshopt.glb --level high
```

The `ktx` executable must be on PATH. References:
[glTF Transform](https://gltf-transform.dev/) and
[Three.js KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html).

## Reproducing cold measurements

Start `node scripts/benchmark-preview.mjs dist 4178`. Run Lighthouse 13.4.1 with a
fresh profile (the CLI default), `--throttling-method=devtools`, and
`--only-categories=performance --output=json --chrome-flags='--headless'`.

- Desktop: `--preset=desktop --throttling.requestLatencyMs=40 --throttling.downloadThroughputKbps=10000 --throttling.uploadThroughputKbps=10000 --pause-after-load-ms=20000 --max-wait-for-load=60000`.
- Mobile: `--throttling.requestLatencyMs=150 --throttling.downloadThroughputKbps=1600 --throttling.uploadThroughputKbps=750 --throttling.cpuSlowdownMultiplier=4 --pause-after-load-ms=90000 --max-wait-for-load=120000`.

Use the `user-timings` audit's Measure duration. Run profiles sequentially and keep
other CPU-heavy tools idle. For the optimized-only final mobile run, a 45-second
post-load pause was sufficient; use 90 seconds when comparing the larger baseline.
