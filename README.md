# Hibiscus 3D

An interactive, photo-guided scarlet hibiscus study built with plain HTML, CSS, and Three.js.

[Open the live viewer](https://fridman.me/hibiscus-3d/)

## Development

```sh
npm ci
npm run dev
```

Open the Vite URL under `/hibiscus-3d/`.

```sh
npm run build
npm run preview
```

The production build is written to `dist/`. The readable viewer source stays in `src/viewer.js`. Production builds minify and embed it into the HTML, saving one JavaScript request. Three.js and its addons remain in a separate preloaded vendor bundle. Model URLs are managed by Vite and work under the GitHub Pages base path.

## Editing the model

- `index.html` and `src/viewer.js`: maintained viewer.
- `assets/hibiscus.glb`: optimized runtime model.
- `project-files/`: editable Blender scene, original photographs, textures, generation scripts, uncompressed export, and an offline viewer snapshot.

See [the working-files guide](project-files/README.md) for model editing and regeneration. The working archive is preserved in Git and excluded from the deployed site.

## Deployment

Pushes to `main` build and deploy `dist/` through GitHub Actions to GitHub Pages. The workflow can also be started manually. The Pages project path is `/hibiscus-3d/`.

## Cold-load optimization

Run `npm run optimize:model` after exporting changes to `project-files/hibiscus.glb`,
then `npm run check:model` and `npm run build`. The pipeline preserves the editable
original, all 623,296 triangles, and separate foliage/dew visibility groups. It joins
compatible static meshes, creates material palettes, resizes textures to at most
1024 pixels, encodes WebP at quality 80, and applies Meshopt compression.
`TEXTURE_SIZE` and `TEXTURE_QUALITY` explicitly override the texture settings.

The HTML loads a small transparent poster before JavaScript/model readiness.
`assets/hibiscus-poster.webp` is a portrait capture of the model; update it if the
model's appearance changes. The renderer keeps authored material sidedness, uses
frustum culling, caches static shadows, and renders only when the view or controls
change. Image export copies a freshly rendered canvas synchronously, preserving
screen colors without `preserveDrawingBuffer` or extra screenshot shaders.

See [the performance report](PERFORMANCE.md) for measured cold-load results and the
KTX2 experiment. `node scripts/benchmark-preview.mjs dist 4178` starts a local Vite
preview with gzip and disabled caching, matching the production transfer encoding.
Lighthouse User Timing `hibiscus-ready` measures the actual complete 3D reveal;
FCP and Lighthouse's default interactive estimate can describe only the HTML shell.

For a live deployment comparison, set `LIGHTHOUSE_ROOT` to the installed Lighthouse
package directory (13.4.1 was used), then run
`node scripts/measure-live.mjs before` before deploying and
`node scripts/measure-live.mjs after` afterward. Each batch saves three desktop and
three mobile cold-cache reports under `artifacts/live-before/` or
`artifacts/live-after/`. The same observer measures loader dismissal in both builds.
Existing report files are reused; move those directories aside to start a new batch.
