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
