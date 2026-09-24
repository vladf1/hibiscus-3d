// Pipeline passes over the Blender export. They are applied to the runtime model
// only; project-files/hibiscus.glb stays the untouched editable original.
import { KHRMaterialsSheen, KHRMaterialsSpecular } from '@gltf-transform/extensions';
import sharp from 'sharp';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function node(document, pattern, untransformed = false) {
  const found = document.getRoot().listNodes().filter((n) => n.getMesh() && pattern.test(n.getName()));
  if (!found.length) throw new Error(`Missing mesh: ${pattern}`);
  for (const n of found) {
    const identity = [...n.getTranslation(), ...n.getRotation(), ...n.getScale()].join();
    if (untransformed && identity !== '0,0,0,0,0,0,1,1,1,1') throw new Error(`Expected untransformed mesh: ${n.getName()}`);
  }
  return found;
}
const primitive = (n) => n.getMesh().listPrimitives()[0];
const positions = (prim) => prim.getAttribute('POSITION').getArray();

// ---------------------------------------------------------------------------
// Dew: every droplet sits on the front (inner) face of its petal, clear of the
// petals that overlap it, with a flattened base resting just above the tissue.
// The Blender export sank each droplet a third of its height into the petal, so
// they showed through the back, and a few sat on the reverse or under a petal.

const PETAL_ROWS = 151, PETAL_COLUMNS = 191; // build_hibiscus.py: nr=150, nc=190
const DROP_RINGS = 10, DROP_SIDES = 16; // refine pass: 10 × 16 vertices per droplet
const DROP_COUNT = 180, CONTACT_GAP = 0.0015;
const FRONT = [0, 1, 0]; // The column points +Y in glTF space.

function petalGrid(n) {
  const array = positions(primitive(n));
  if (array.length !== PETAL_ROWS * PETAL_COLUMNS * 3) throw new Error(`Unexpected petal grid: ${n.getName()}`);
  const clampRow = (j) => Math.min(PETAL_ROWS - 1, Math.max(0, j));
  const clampColumn = (k) => Math.min(PETAL_COLUMNS - 1, Math.max(0, k));
  const point = (j, k) => { const i = (clampRow(j) * PETAL_COLUMNS + clampColumn(k)) * 3; return [array[i], array[i + 1], array[i + 2]]; };
  const along = (j, k) => sub(point(j + 1, k), point(j - 1, k));
  const raw = (j, k) => normalize(cross(along(j, k), sub(point(j, k + 1), point(j, k - 1))));
  // The inner face looks toward the front where the petal leaves the throat.
  let facing = 0;
  for (let j = 10; j < 60; j++) facing += dot(raw(j, 95), FRONT);
  const sign = Math.sign(facing);
  return { array, point, along, normal: (j, k) => raw(j, k).map((x) => x * sign) };
}

// Distance along -direction from origin to the petal, searching grid cells near (j, k).
function surfaceDistance(petal, j, k, origin, direction) {
  let best = Infinity;
  for (let a = Math.max(0, j - 6); a < Math.min(PETAL_ROWS - 1, j + 6); a++) {
    for (let b = Math.max(0, k - 12); b < Math.min(PETAL_COLUMNS - 1, k + 12); b++) {
      const p00 = petal.point(a, b), p01 = petal.point(a, b + 1), p10 = petal.point(a + 1, b), p11 = petal.point(a + 1, b + 1);
      for (const [p, q, r] of [[p00, p10, p11], [p00, p11, p01]]) {
        // Möller–Trumbore, with the ray pointing into the petal.
        const e1 = sub(q, p), e2 = sub(r, p), ray = direction.map((x) => -x);
        const h = cross(ray, e2), det = dot(e1, h);
        if (Math.abs(det) < 1e-12) continue;
        const s = sub(origin, p), u = dot(s, h) / det;
        if (u < 0 || u > 1) continue;
        const qv = cross(s, e1), v = dot(ray, qv) / det;
        if (v < 0 || u + v > 1) continue;
        const t = dot(e2, qv) / det;
        if (t > 0 && Math.abs(t - 0.2) < Math.abs(best - 0.2)) best = t;
      }
    }
  }
  return best;
}

// Droplets keep the refine pass's shape: an ellipsoid 0.66 as tall as it is wide,
// centered 0.35 radii above the petal.
const dropletCenter = (petal, j, k, radius) => add(petal.point(j, k), petal.normal(j, k), 0.35 * radius);
function buildDroplet(petal, j, k, radius) {
  const normal = petal.normal(j, k), center = dropletCenter(petal, j, k, radius);
  const tangent = normalize(add(petal.along(j, k), normal, -dot(petal.along(j, k), normal)));
  const bitangent = cross(normal, tangent);
  const height = 0.66 * radius;
  const vertices = [], normals = [];
  for (let ring = 0; ring < DROP_RINGS; ring++) {
    const theta = (Math.PI * ring) / (DROP_RINGS - 1);
    for (let side = 0; side < DROP_SIDES; side++) {
      const phi = (2 * Math.PI * side) / DROP_SIDES;
      const x = radius * Math.sin(theta) * Math.cos(phi), y = radius * Math.sin(theta) * Math.sin(phi), z = height * Math.cos(theta);
      let vertex = add(add(add(center, tangent, x), bitangent, y), normal, z);
      let outward = normalize(add(add(tangent.map((c) => (c * x) / radius ** 2), bitangent, y / radius ** 2), normal, z / height ** 2));
      // Lower vertices are pressed onto the petal, forming the droplet's contact face.
      const gap = surfaceDistance(petal, j, k, add(vertex, normal, 0.2), normal) - 0.2;
      if (!Number.isFinite(gap)) return null; // Overhangs the petal edge.
      if (gap < CONTACT_GAP) { vertex = add(vertex, normal, CONTACT_GAP - gap); outward = normal.map((c) => -c); }
      vertices.push(vertex);
      // Blender's batched ellipsoids wind inward, and their normals follow that winding.
      normals.push(outward.map((c) => -c));
    }
  }
  return { center, normal, radius, vertices, normals };
}

export function seatDew(document) {
  const petalNodes = node(document, /^Petal \d • /, true).sort((a, b) => a.getName().localeCompare(b.getName()));
  const petals = petalNodes.map(petalGrid);
  const dew = primitive(node(document, /dew droplets/, true)[0]);
  const source = positions(dew);
  if (source.length !== DROP_COUNT * DROP_RINGS * DROP_SIDES * 3) throw new Error('Unexpected dew droplet layout.');
  const perDrop = DROP_RINGS * DROP_SIDES;
  const placed = [];
  let moved = 0;

  const clear = (center, normal, radius, petalIndex, j, k) => {
    if (!placed.every((other) => Math.hypot(...sub(other.center, center)) > other.radius + radius + 0.01)) return false;
    // Other petals, and distant folds of this one, must not pass over the droplet.
    for (const [index, petal] of petals.entries()) {
      for (let row = 0; row < PETAL_ROWS; row++) {
        for (let column = 0; column < PETAL_COLUMNS; column++) {
          if (index === petalIndex && Math.abs(row - j) <= 8 && Math.abs(column - k) <= 20) continue;
          const offset = sub(petal.point(row, column), center), above = dot(offset, normal);
          if (above < -0.02 || above > 0.5) continue;
          if (Math.hypot(...add(offset, normal, -above)) < radius + 0.03) return false;
        }
      }
    }
    return true;
  };
  const attempt = (petalIndex, j, k, radius) => {
    if (j < 60 || j > 147 || k < 4 || k > 186) return null; // u 0.4–0.98, |v| ≤ 0.96
    const petal = petals[petalIndex], normal = petal.normal(j, k);
    if (dot(normal, FRONT) < 0.3) return null;
    if (!clear(dropletCenter(petal, j, k, radius), normal, radius, petalIndex, j, k)) return null;
    return buildDroplet(petal, j, k, radius);
  };

  for (let d = 0; d < DROP_COUNT; d++) {
    const vertices = [];
    for (let i = d * perDrop; i < (d + 1) * perDrop; i++) vertices.push([source[i * 3], source[i * 3 + 1], source[i * 3 + 2]]);
    const center = [0, 1, 2].map((axis) => vertices.reduce((sum, v) => sum + v[axis], 0) / perDrop);
    // The widest rings sit 10° from the equator.
    const radius = Math.max(...vertices.map((v) => Math.hypot(...sub(v, center)))) / Math.sin((4 * Math.PI) / 9);
    let nearest = { distance: Infinity };
    petals.forEach((petal, petalIndex) => {
      for (let i = 0; i < petal.array.length; i += 3) {
        const distance = Math.hypot(petal.array[i] - center[0], petal.array[i + 1] - center[1], petal.array[i + 2] - center[2]);
        if (distance < nearest.distance) nearest = { distance, petalIndex, j: Math.floor(i / 3 / PETAL_COLUMNS), k: (i / 3) % PETAL_COLUMNS };
      }
    });
    let drop = attempt(nearest.petalIndex, nearest.j, nearest.k, radius);
    // Otherwise move it to the nearest free spot on the same petal's front.
    const next = random(9234 + d);
    for (let tries = 0; !drop && tries < 4000; tries++) {
      const spread = Math.min(1, 0.05 + tries / 1500);
      drop = attempt(nearest.petalIndex, Math.round(nearest.j + (next() * 2 - 1) * 80 * spread), Math.round(nearest.k + (next() * 2 - 1) * 170 * spread), radius);
      if (drop) moved++;
    }
    if (!drop) throw new Error(`No free front-facing spot for dew droplet ${d}.`);
    placed.push(drop);
  }
  dew.getAttribute('POSITION').setArray(new Float32Array(placed.flatMap((drop) => drop.vertices.flat())));
  dew.getAttribute('NORMAL').setArray(new Float32Array(placed.flatMap((drop) => drop.normals.flat())));
  return { droplets: placed.length, moved };
}

// ---------------------------------------------------------------------------
// Stems and calyx: the export has flat colors and no UVs on these tubes, which
// read as plastic up close. Give them surface-following UVs and a shared, tiling
// epidermis texture: longitudinal ridges and fibers, pale lenticels, and fine
// grain, with a matte velvet sheen instead of a glossy highlight.

const TILE = 0.4; // World units covered by one texture tile.
const TEXTURE_SIZE = 512;
const TUBES = [
  [/^Foliage stem • /, 18], [/^Foliage pedicel • /, 16], [/^Foliage leaf \d+ petiole$/, 10],
  [/^Epicalyx bract \d+$/, 8], [/^Green receptacle$/, 32],
];
const SEPALS = [/^Pointed calyx sepal \d+$/, 13];
// Blender's flat colors. Each material divides out the texture's mean color, so
// the textured surfaces keep their average color.
const TINTS = {
  'Foliage stem • olive green': [0.11, 0.22, 0.027],
  'Fresh green pedicel': [0.17, 0.29, 0.035],
  'Calyx • moss green': [0.13, 0.23, 0.022],
};
const MEAN = [0.2, 0.33, 0.055];

// Rings of `sides` vertices swept along a path, as the Blender builders emit them.
// Closed tubes get a duplicated seam column so the texture wraps without a jump.
function sweepUVs(document, prim, sides, closed) {
  const position = positions(prim), normal = prim.getAttribute('NORMAL').getArray();
  const count = position.length / 3, rings = count / sides;
  if (!Number.isInteger(rings)) throw new Error(`Unexpected ring layout: ${sides} sides, ${count} vertices.`);
  const point = (ring, side) => [0, 1, 2].map((a) => position[(ring * sides + side) * 3 + a]);
  // Mean step over each ring follows the centerline of bent tubes and the meridians of the receptacle.
  const along = [0];
  let perimeter = 0;
  for (let ring = 1; ring < rings; ring++) {
    let step = 0;
    for (let side = 0; side < sides; side++) step += Math.hypot(...sub(point(ring, side), point(ring - 1, side)));
    along.push(along[ring - 1] + step / sides);
  }
  for (let ring = 0; ring < rings; ring++) {
    let length = 0;
    for (let side = 0; side < sides - (closed ? 0 : 1); side++) length += Math.hypot(...sub(point(ring, (side + 1) % sides), point(ring, side)));
    perimeter += length;
  }
  const repeats = Math.max(1, Math.round(perimeter / rings / TILE));
  const columns = closed ? sides + 1 : sides;
  const out = { position: new Float32Array(rings * columns * 3), normal: new Float32Array(rings * columns * 3), uv: new Float32Array(rings * columns * 2) };
  for (let ring = 0; ring < rings; ring++) {
    for (let column = 0; column < columns; column++) {
      const source = (ring * sides + (column % sides)) * 3, target = ring * columns + column;
      out.position.set(position.subarray(source, source + 3), target * 3);
      out.normal.set(normal.subarray(source, source + 3), target * 3);
      out.uv.set([(column / (closed ? sides : sides - 1)) * repeats, along[ring] / TILE], target * 2);
    }
  }
  const remap = (index) => Math.floor(index / sides) * columns + (index % sides);
  const indices = prim.getIndices().getArray(), next = new Uint32Array(indices.length);
  for (let t = 0; t < indices.length; t += 3) {
    const triangle = [indices[t], indices[t + 1], indices[t + 2]];
    // Triangles across the seam use the duplicated column at u = repeats.
    const seam = closed && triangle.some((i) => i % sides === sides - 1) && triangle.some((i) => i % sides === 0);
    triangle.forEach((i, c) => { next[t + c] = remap(i) + (seam && i % sides === 0 ? sides : 0); });
  }
  const buffer = document.getRoot().listBuffers()[0];
  const accessor = (array, type) => document.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  prim.setAttribute('POSITION', accessor(out.position, 'VEC3'))
    .setAttribute('NORMAL', accessor(out.normal, 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor(out.uv, 'VEC2'))
    .setIndices(accessor(rings * columns > 65535 ? next : Uint16Array.from(next), 'SCALAR'));
}

// Tiling value noise: `columns` cells around the stem, `rows` cells along it.
function noise(columns, rows, next) {
  const lattice = Float32Array.from({ length: columns * rows }, () => next() * 2 - 1);
  const out = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    const fy = (y * rows) / TEXTURE_SIZE, y0 = Math.floor(fy), ty = smooth(fy - y0), y1 = (y0 + 1) % rows;
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const fx = (x * columns) / TEXTURE_SIZE, x0 = Math.floor(fx), tx = smooth(fx - x0), x1 = (x0 + 1) % columns;
      const top = lattice[y0 * columns + x0] * (1 - tx) + lattice[y0 * columns + x1] * tx;
      const bottom = lattice[y1 * columns + x0] * (1 - tx) + lattice[y1 * columns + x1] * tx;
      out[y * TEXTURE_SIZE + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

async function epidermisTextures() {
  const n = TEXTURE_SIZE, next = random(6061);
  const wrap = (x) => ((x % n) + n) % n;
  const warp = noise(3, 4, next), ridgeAmplitude = noise(7, 3, next);
  const fibers = noise(150, 6, next), fineFibers = noise(300, 14, next), grain = noise(200, 200, next);
  const broad = noise(4, 3, next), streaks = noise(40, 3, next), blush = noise(3, 2, next);
  // Lenticels: small raised pale dashes, stretched along the stem.
  const dots = new Float32Array(n * n);
  for (let i = 0; i < 50; i++) {
    const cx = next() * n, cy = next() * n, sx = 1.2 + next(), sy = 2.5 + next() * 3, strength = 0.5 + next() * 0.5;
    for (let y = Math.floor(cy - 3 * sy); y <= cy + 3 * sy; y++) {
      for (let x = Math.floor(cx - 3 * sx); x <= cx + 3 * sx; x++) {
        dots[wrap(y) * n + wrap(x)] += strength * Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
      }
    }
  }
  const ridges = new Float32Array(n * n), height = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const x = i % n;
    ridges[i] = (0.5 + 0.5 * Math.cos(2 * Math.PI * (7 * x / n + 0.3 * warp[i]))) * (0.65 + 0.35 * ridgeAmplitude[i]);
    height[i] = 0.9 * ridges[i] + 0.12 * fibers[i] + 0.05 * fineFibers[i] + 0.035 * grain[i] + 0.25 * Math.min(1, dots[i]);
  }
  const color = Buffer.alloc(n * n * 3), normal = Buffer.alloc(n * n * 3);
  const srgb = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const lum = 1 + 0.12 * broad[i] + 0.08 * fibers[i] + 0.05 * fineFibers[i] + 0.05 * grain[i] + 0.16 * (ridges[i] - 0.5);
      const yellow = 0.5 + 0.5 * streaks[i], red = Math.max(0, blush[i] - 0.3);
      let rgb = [MEAN[0] * lum * (1 + 0.2 * (yellow - 0.5) + 0.5 * red), MEAN[1] * lum * (1 - 0.15 * red), MEAN[2] * lum * (1 - 0.3 * (yellow - 0.5))];
      const pale = Math.min(1, dots[i]) * 0.55;
      rgb = rgb.map((c, a) => c * (1 - pale) + [0.36, 0.42, 0.16][a] * pale);
      rgb.forEach((c, a) => { color[i * 3 + a] = srgb(Math.min(1, Math.max(0, c))); });
      // OpenGL convention (+Y up), matching the Blender-generated normal maps.
      const dx = (height[y * n + wrap(x + 1)] - height[y * n + wrap(x - 1)]) / 2;
      const dy = (height[wrap(y + 1) * n + x] - height[wrap(y - 1) * n + x]) / 2;
      normalize([-dx * 9, dy * 9, 1]).forEach((c, a) => { normal[i * 3 + a] = Math.round((c * 0.5 + 0.5) * 255); });
    }
  }
  const png = (data) => sharp(data, { raw: { width: n, height: n, channels: 3 } }).png().toBuffer();
  return { color: await png(color), normal: await png(normal) };
}

export async function textureStemsAndCalyx(document) {
  for (const [pattern, sides] of TUBES) for (const n of node(document, pattern)) sweepUVs(document, primitive(n), sides, true);
  for (const n of node(document, SEPALS[0])) sweepUVs(document, primitive(n), SEPALS[1], false);
  const images = await epidermisTextures();
  const color = document.createTexture('green-epidermis-pigment').setImage(images.color).setMimeType('image/png');
  const normal = document.createTexture('green-epidermis-ridges').setImage(images.normal).setMimeType('image/png');
  const sheen = document.createExtension(KHRMaterialsSheen), specular = document.createExtension(KHRMaterialsSpecular);
  for (const material of document.getRoot().listMaterials()) {
    const tint = TINTS[material.getName()];
    if (!tint) continue;
    material.setBaseColorFactor([...tint.map((c, a) => c / MEAN[a]), 1]).setBaseColorTexture(color)
      .setNormalTexture(normal).setNormalScale(1).setRoughnessFactor(0.7)
      .setExtension('KHR_materials_sheen', sheen.createSheen().setSheenColorFactor([0.07, 0.09, 0.045]).setSheenRoughnessFactor(0.45))
      .setExtension('KHR_materials_specular', specular.createSpecular().setSpecularFactor(0.5));
  }
  const missing = Object.keys(TINTS).filter((name) => !document.getRoot().listMaterials().some((m) => m.getName() === name));
  if (missing.length) throw new Error(`Missing stem materials: ${missing.join(', ')}`);
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getName() in TINTS && !prim.getAttribute('TEXCOORD_0')) throw new Error(`Textured stem mesh has no UVs: ${mesh.getName()}`);
    }
  }
}
