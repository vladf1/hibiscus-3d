import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import fullModelUrl from "../assets/hibiscus.glb?url";

// Full-resolution vein normal maps, streamed after the core model.
const detailTextures = Object.entries(
  import.meta.glob("../assets/textures/*.webp", {
    eager: true,
    query: "?url",
    import: "default",
  }),
).map(([path, url]) => ({ name: path.match(/([^/]+)\.webp$/)[1], url }));

// Renderer, camera, and lighting.
const select = (selector) => document.querySelector(selector);
const host = select("#stage");
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.5 : 2));
renderer.setClearColor(0, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
host.appendChild(renderer.domElement);
renderer.domElement.setAttribute(
  "aria-label",
  "Interactive 3D hibiscus. Drag to orbit, scroll to zoom, right-drag to pan.",
);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 150);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 1;
controls.maxDistance = 30;
controls.autoRotateSpeed = 0.65;
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.025);
scene.environment = environment.texture;
scene.environmentIntensity = 0.25;
room.dispose();
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xf6f5e6, 0x355438, 0.6));
function addDirectionalLight(position, color, intensity) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(...position);
  if (position[0] === -4 && position[1] === 7) {
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -6,
      right: 6,
      top: 6,
      bottom: -6,
      near: 0.1,
      far: 30,
    });
    light.shadow.bias = -0.0003;
    light.shadow.normalBias = 0.025;
  }
  scene.add(light);
}
addDirectionalLight([-4, 7, 9], 0xfff0e0, 1.28);
addDirectionalLight([5, 2, 5], 0xe3efff, 0.84);
addDirectionalLight([-4, 3, -5], 0xffb79e, 1.0);
const materials = [];
const meshes = [];
let flower;
let transition = null;
let loaded = false;
let renderRequested = true;
controls.addEventListener("change", () => { renderRequested = true; });

// Camera presets and animated transitions.
const presets = {
  portrait: { position: [5.2, 0.6, 11.6], target: [0, -0.85, 0.6] },
  front: { position: [0, -0.05, 10.8], target: [0, 0, 0.65] },
  side: { position: [10.7, 0.9, 1.1], target: [0, -0.15, 1] },
  back: { position: [-2.6, 1, -11.2], target: [0, -0.5, -0.45] },
  macro: { position: [2, 1.1, 6.6], target: [-0.32, 0.0, 3.45] },
};
function go(name, instant = false) {
  const source = presets[name];
  const responsiveFactor = Math.max(1, 0.78 / camera.aspect);
  // Preserve the poster's perspective on narrow screens: widen the lens rather
  // than moving the portrait camera away from the flower.
  const factor = name === "portrait" ? 1.12 : name === "macro" ? 1 : responsiveFactor;
  camera.zoom = name === "portrait" ? 1 / responsiveFactor : 1;
  camera.updateProjectionMatrix();
  const view = source
    ? {
        target: source.target,
        position: source.position.map(
          (x, i) => source.target[i] + (x - source.target[i]) * factor,
        ),
      }
    : null;
  if (!view) return;
  controls.autoRotate = false;
  select("#rotate").setAttribute("aria-pressed", "false");
  select(".view.active")?.classList.remove("active");
  select(`[data-view="${name}"]`)?.classList.add("active");
  if (instant) {
    camera.position.set(...view.position);
    controls.target.set(...view.target);
    controls.update();
  } else
    transition = {
      from: camera.position.clone(),
      to: new THREE.Vector3(...view.position),
      startTarget: controls.target.clone(),
      endTarget: new THREE.Vector3(...view.target),
      time: performance.now(),
    };
  select("#view-name").textContent = {
    portrait: "Three-quarter portrait",
    front: "Corolla · front",
    side: "Profile · side",
    back: "Calyx · reverse",
    macro: "Stigma & pollen · macro",
  }[name];
}
go("portrait", true);
function resize() {
  const w = host.clientWidth,
    h = host.clientHeight;
  renderer.setSize(w, h);
  renderRequested = true;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!loaded) go("portrait", true);
}
new ResizeObserver(resize).observe(host);
resize();

// Builds gzip the core model themselves, so its transfer size does not depend
// on whether the host compresses GLB files. The dev server sends it plain.
async function readModel(response) {
  const bytes = await response.arrayBuffer();
  const [a, b] = new Uint8Array(bytes, 0, 2);
  if (a !== 0x1f || b !== 0x8b) return bytes;
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

// Download detail textures in two waves so the petals finish first. They are
// decoded after the reveal and uploaded within a small per-frame budget.
function downloadDetails() {
  const fetchBlob = async ({ name, url }) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Texture download failed: ${name}`);
    return response.blob();
  };
  const downloads = new Map();
  for (const texture of detailTextures)
    if (texture.name.startsWith("petal"))
      downloads.set(texture.name, fetchBlob(texture));
  const firstWave = Promise.allSettled(downloads.values());
  for (const texture of detailTextures)
    if (!downloads.has(texture.name))
      downloads.set(texture.name, firstWave.then(() => fetchBlob(texture)));
  // Failures are reported once the textures are applied.
  for (const blob of downloads.values()) blob.catch(() => {});
  return downloads;
}
const uploads = [];
async function decodeDetail(preview, blob) {
  // Match GLTFLoader's decoding, so orientation and color handling are unchanged.
  if (typeof ImageBitmap !== "undefined" && preview.image instanceof ImageBitmap)
    return createImageBitmap(await blob, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
  const image = new Image();
  image.src = URL.createObjectURL(await blob);
  try {
    await image.decode();
  } finally {
    URL.revokeObjectURL(image.src);
  }
  return image;
}
function streamDetails(downloads) {
  const previews = new Map();
  for (const material of materials)
    if (downloads.has(material.normalMap?.name))
      previews.set(material.normalMap, [
        ...(previews.get(material.normalMap) ?? []),
        material,
      ]);
  return Promise.allSettled(
    [...previews].map(async ([preview, users]) => {
      const image = await decodeDetail(preview, downloads.get(preview.name));
      const texture = preview.clone();
      texture.source = new THREE.Source(image);
      texture.needsUpdate = true;
      await new Promise((resolve) => uploads.push({ preview, texture, users, resolve }));
    }),
  ).then((results) => {
    for (const { reason } of results) if (reason) console.warn(reason);
    performance.mark("hibiscus-detailed");
    performance.measure("hibiscus-detailed", {
      start: 0,
      end: "hibiscus-detailed",
    });
  });
}
function uploadDetails() {
  // Spend at most a few milliseconds per frame, but always make progress.
  const start = performance.now();
  while (uploads.length) {
    const { preview, texture, users, resolve } = uploads.shift();
    renderer.initTexture(texture);
    for (const material of users) material.normalMap = texture;
    preview.dispose();
    preview.image.close?.();
    renderRequested = true;
    resolve();
    if (performance.now() - start > 6) break;
  }
}

// Reuse the model preload, then prepare the complete flower before revealing it.
async function loadFlower() {
  try {
    // Browsers without DecompressionStream load the full model instead.
    const progressive = typeof DecompressionStream !== "undefined";
    const response = await fetch(
      progressive ? select("#model-preload").href : fullModelUrl,
      { mode: "cors", credentials: "same-origin" },
    );
    if (!response.ok) throw new Error("Model download failed");
    const modelBuffer = await readModel(response);
    const downloads = progressive ? downloadDetails() : new Map();
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(modelBuffer, "");
    flower = gltf.scene;
    flower.rotation.x = Math.PI / 2;
    scene.add(flower);
    flower.traverse((object) => {
      if (object.isMesh) {
        meshes.push(object);
        if (object.userData.controlGroup === "foliage") object.visible = select("#foliage").checked;
        if (object.userData.controlGroup === "dew") object.visible = select("#dew").checked;
        object.receiveShadow = true;
        object.castShadow = object.userData.shadowCaster === true;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          material.envMapIntensity = 0.65;
          material.wireframe = select("#wire").checked;
          if (material.name.includes("Scarlet")) {
            material.roughness = 0.64;
            material.normalScale.set(0.48, 0.48);
            material.sheen = 0;
            material.specularIntensity = 0.4;
          }
          if (material.name.includes("Water") || material.transmission > 0) {
            material.envMapIntensity = 1.2;
          }
          materials.push(material);
        }
      }
    });
    // Prepare shaders before the animation loop can render the flower.
    select("#loading").textContent = "Preparing the flower…";
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    loaded = true;
    performance.mark("hibiscus-ready");
    performance.measure("hibiscus-ready", { start: 0, end: "hibiscus-ready" });
    select("#loading").classList.add("loaded");
    select("#poster").classList.add("loaded");
    select("#stage").setAttribute("aria-busy", "false");
    select("#status").textContent = "MODEL READY";
    select("#mesh-count").textContent =
      `${Math.round(meshes.reduce((a, m) => a + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0) / 1000)}k triangles`;
    streamDetails(downloads);
    window.hibiscus = {
      scene,
      camera,
      renderer,
      controls,
      flower,
      meshes,
      go,
      get ready() {
        return loaded;
      },
    };
  } catch (e) {
    select("#loading").textContent =
      "Could not open the flower. Please refresh to try again.";
    console.error(e);
  }
}
loadFlower();

// Camera, display, and download controls.
for (const button of document.querySelectorAll("[data-view]")) {
  button.onclick = () => go(button.dataset.view);
}
select("#rotate").onclick = () => {
  transition = null;
  controls.autoRotate = !controls.autoRotate;
  select("#rotate").setAttribute("aria-pressed", String(controls.autoRotate));
};
select("#reset").onclick = () => go("portrait");
select("#foliage").onchange = (e) => {
  meshes
    .filter((o) => o.userData.controlGroup === "foliage")
    .forEach((o) => (o.visible = e.target.checked));
  renderer.shadowMap.needsUpdate = true;
  renderRequested = true;
};
select("#dew").onchange = (e) => {
  renderRequested = true;
  meshes
    .filter((o) => o.userData.controlGroup === "dew")
    .forEach((o) => (o.visible = e.target.checked));
};
select("#wire").onchange = (e) => {
  materials.forEach((m) => (m.wireframe = e.target.checked));
  renderRequested = true;
  renderer.shadowMap.needsUpdate = true;
};
select("#exposure").oninput = (e) => {
  renderer.toneMappingExposure = +e.target.value;
  renderRequested = true;
};
select("#background").onclick = () => {
  document.body.classList.toggle("light");
  select("#background").setAttribute(
    "aria-pressed",
    String(document.body.classList.contains("light")),
  );
};
select("#fullscreen").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
};
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
select("#save").onclick = () => {
  if (!loaded) return;
  // Copy synchronously before the browser discards the drawing buffer. This
  // retains the exact screen tone mapping without a permanently preserved buffer.
  renderer.render(scene, camera);
  const canvas = document.createElement("canvas");
  canvas.width = renderer.domElement.width;
  canvas.height = renderer.domElement.height;
  canvas.getContext("2d").drawImage(renderer.domElement, 0, 0);
  canvas.toBlob(blob => blob && download(blob, "hibiscus-view.png"));
};
select("#glb").onclick = () => {
  // The full-quality model is only downloaded on request.
  const a = document.createElement("a");
  a.href = fullModelUrl;
  a.download = "hibiscus.glb";
  a.click();
};
select("#details").onclick = () => {
  const p = select("#detail-panel");
  p.hidden = !p.hidden;
  select("#details").setAttribute("aria-expanded", String(!p.hidden));
};
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.code === "Space") {
    e.preventDefault();
    select("#rotate").click();
  }
  if (e.key.toLowerCase() === "r") go("portrait");
  if (e.key === "Escape") select("#detail-panel").hidden = true;
});
controls.addEventListener("start", () => (transition = null));

// Render only once model loading and shader preparation have completed.
function frame(now) {
  requestAnimationFrame(frame);
  if (transition) {
    let t = Math.min((now - transition.time) / 850, 1);
    t = t * t * (3 - 2 * t);
    camera.position.lerpVectors(transition.from, transition.to, t);
    controls.target.lerpVectors(
      transition.startTarget,
      transition.endTarget,
      t,
    );
    if (t >= 1) transition = null;
  }
  controls.update();
  if (loaded) uploadDetails();
  if (loaded && renderRequested) {
    renderer.render(scene, camera);
    renderRequested = false;
  }
}
requestAnimationFrame(frame);
