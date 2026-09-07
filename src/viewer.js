import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// Renderer, camera, and lighting.
const select = (selector) => document.querySelector(selector);
const host = select("#stage");
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.5 : 2));
renderer.setClearColor(0, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
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
  const factor = name === "macro" ? 1 : Math.max(1, 0.78 / camera.aspect);
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
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!loaded) go("portrait", true);
}
new ResizeObserver(resize).observe(host);
resize();

// Reuse the model preload, then prepare the complete flower before revealing it.
let modelBytes;
async function loadFlower() {
  try {
    const response = await fetch(select("#model-preload").href, {
      mode: "cors",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Model download failed");
    modelBytes = new Uint8Array(await response.arrayBuffer());
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .parseAsync(modelBytes.buffer, "");
    flower = gltf.scene;
    flower.rotation.x = Math.PI / 2;
    scene.add(flower);
    flower.traverse((object) => {
      if (object.isMesh) {
        meshes.push(object);
        object.frustumCulled = false;
        object.receiveShadow = true;
        object.castShadow = /Petal|leaf|column|throat|sepal/i.test(object.name);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          material.side = THREE.DoubleSide;
          material.envMapIntensity = 0.65;
          if (material.name.includes("Scarlet")) {
            material.roughness = 0.64;
            material.normalScale.set(0.48, 0.48);
            material.sheen = 0;
            material.specularIntensity = 0.4;
          }
          if (material.name.includes("Water")) {
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
    select("#loading").classList.add("loaded");
    select("#status").textContent = "MODEL READY";
    select("#mesh-count").textContent =
      `${Math.round(meshes.reduce((a, m) => a + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0) / 1000)}k triangles`;
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
    .filter((o) => /Leaf|leaf|pedicel|stem|petiole/i.test(o.name))
    .forEach((o) => (o.visible = e.target.checked));
};
select("#dew").onchange = (e) =>
  meshes
    .filter((o) => /dew.droplets/i.test(o.name))
    .forEach((o) => (o.visible = e.target.checked));
select("#wire").onchange = (e) =>
  materials.forEach((m) => (m.wireframe = e.target.checked));
select("#exposure").oninput = (e) =>
  (renderer.toneMappingExposure = +e.target.value);
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
  renderer.render(scene, camera);
  renderer.domElement.toBlob((b) => download(b, "hibiscus-view.png"));
};
select("#glb").onclick = () =>
  modelBytes &&
  download(
    new Blob([modelBytes], { type: "model/gltf-binary" }),
    "hibiscus.glb",
  );
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
  if (loaded) renderer.render(scene, camera);
}
requestAnimationFrame(frame);
