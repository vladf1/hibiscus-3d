import { compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

function read(accessor) {
  const size = accessor.getElementSize(), array = new Float32Array(accessor.getCount() * size), element = [];
  for (let i = 0; i < accessor.getCount(); i++) array.set(accessor.getElement(i, element), i * size);
  return array;
}

// Simplify one indexed triangle primitive with meshoptimizer. Normals and UVs are
// weighed so shading and texture placement survive, and the remaining vertices (with
// their normals and UVs) move to fit the original surface. PreserveFolds keeps thin
// double-sided petals from eroding.
export function simplifyMesh(document, primitive, {ratio = 0, error, normalWeight = 0.5, uvWeight = 1}) {
  const semantics = primitive.listSemantics();
  if (semantics.some(s => !['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s)) || primitive.listTargets().length)
    return false;
  const positions = read(primitive.getAttribute('POSITION'));
  const count = positions.length / 3;
  const normals = primitive.getAttribute('NORMAL') && read(primitive.getAttribute('NORMAL'));
  const uvs = primitive.getAttribute('TEXCOORD_0') && read(primitive.getAttribute('TEXCOORD_0'));
  const stride = (normals ? 3 : 0) + (uvs ? 2 : 0);
  const attributes = new Float32Array(Math.max(1, count * stride));
  for (let i = 0; i < count; i++) {
    if (normals) attributes.set(normals.subarray(i * 3, i * 3 + 3), i * stride);
    if (uvs) attributes.set(uvs.subarray(i * 2, i * 2 + 2), i * stride + (normals ? 3 : 0));
  }
  const weights = [...(normals ? Array(3).fill(normalWeight) : []), ...(uvs ? [uvWeight, uvWeight] : [])];
  const indices = new Uint32Array(primitive.getIndices().getArray());
  const target = Math.floor(ratio * indices.length / 3) * 3;
  const [indexCount] = MeshoptSimplifier.simplifyWithUpdate(indices, positions, 3, attributes, stride, weights, null, target, error, ['PreserveFolds']);
  const buffer = primitive.getIndices().getBuffer();
  const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  primitive.setIndices(accessor('SCALAR', indices.slice(0, indexCount)));
  primitive.setAttribute('POSITION', accessor('VEC3', positions));
  if (normals) {
    for (let i = 0; i < count; i++) {
      const n = attributes.subarray(i * stride, i * stride + 3), length = Math.hypot(...n) || 1;
      normals.set([n[0] / length, n[1] / length, n[2] / length], i * 3);
    }
    primitive.setAttribute('NORMAL', accessor('VEC3', normals));
  }
  if (uvs) {
    // Keep moved UVs inside the original range, so they can still be quantized.
    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    uvs.forEach((value, i) => { min[i % 2] = Math.min(min[i % 2], value); max[i % 2] = Math.max(max[i % 2], value); });
    for (let i = 0; i < count; i++) {
      const offset = i * stride + (normals ? 3 : 0);
      for (let c = 0; c < 2; c++) uvs[i * 2 + c] = Math.min(max[c], Math.max(min[c], attributes[offset + c]));
    }
    primitive.setAttribute('TEXCOORD_0', accessor('VEC2', uvs));
  }
  compactPrimitive(primitive);
  return true;
}
