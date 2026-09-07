# Hibiscus reconstruction

Photo-guided reconstruction from IMG_5425–IMG_5428. The latest sculpt gives each of the five petals a different outline, width, angle, twist, curl and droop. Each has a separately seeded pigment map and branching vein normal map. Dew is clustered unevenly. Unseen surfaces and scale are interpreted.

Blender 5.2.1 LTS; Blender MCP 1.9.1. The model was generated and revised through the MCP execute_blender_code tool. The server is configured in Codex as `blender`, with telemetry disabled. The add-on starts locally with Blender.

The foliage has ten independent leaf forms with staggered attachment points, varied angles, sizes, curls and serration, unique pigment and vein textures, and a younger upright growing tip. The main builder runs refine_foliage.py as its final pass.

Rebuild with Blender's Python runner using build_hibiscus.py in a fresh Blender session. The script retains existing scenes and creates a new botanical scene. Outputs are written to project-files beside the source directory.

The web viewer is plain HTML, CSS and Three.js. The hosted model uses Meshopt geometry compression and WebP textures. No React or UI framework is used.
