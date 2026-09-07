# Agent Notes

- Use Vite for local HTTP testing: `npm run dev` or `npm run preview` after building.
- GitHub Pages serves this project under `/hibiscus-3d/`; preserve that base path.
- Keep Three.js and its addons in the separate `three-vendor` bundle.
- `project-files/` contains the editable originals. Preserve them; only `dist/` is deployed.
- Run `npm run build` and verify the viewer after changes to bundling or model loading.
