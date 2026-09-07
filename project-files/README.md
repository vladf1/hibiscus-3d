# Hibiscus working files

- `hibiscus.blend`: editable Blender 5.2 project, with packed textures.
- `originals/`: all four full-resolution original photos, unchanged.
- `hibiscus.glb`: uncompressed model export.
- `hibiscus.html`: self-contained offline viewer snapshot.
- `textures/`: original texture images.
- `source/`: modeling scripts and the previous viewer source snapshots.

Open hibiscus.blend to continue modeling. To regenerate, run source/build_hibiscus.py with Blender; its final pass invokes source/refine_foliage.py. Both scripts resolve their output directory relative to themselves. Rebuilding replaces generated model files here.

The maintained web viewer is ../index.html and ../src/viewer.js, built by the repository's root Vite configuration. The web model is ../assets/hibiscus.glb. Working files stay in the repository; only viewer dependencies are included in the Pages build.
