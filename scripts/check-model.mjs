import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const original = await io.read('project-files/hibiscus.glb');
const optimized = await io.read('assets/hibiscus.glb');
function counts(doc, runtime) {
  const result={flower:0,foliage:0,dew:0};
  for(const node of doc.getRoot().listNodes()) {
    if(!node.getMesh())continue;
    const group=runtime ? node.getExtras().controlGroup : /dew.droplets/i.test(node.getName())?'dew':/Leaf|pedicel|stem|petiole/i.test(node.getName())?'foliage':'flower';
    assert.ok(group in result,`Missing control group: ${node.getName()}`);
    for(const primitive of node.getMesh().listPrimitives())result[group]+=(primitive.getIndices()?.getCount()??primitive.getAttribute('POSITION').getCount())/3;
  }
  return result;
}
assert.deepEqual(counts(optimized,true),counts(original,false),'Triangle counts must survive in each control group');
const a=getBounds(original.getRoot().listScenes()[0]),b=getBounds(optimized.getRoot().listScenes()[0]);
for(const key of ['min','max'])for(let i=0;i<3;i++)assert.ok(Math.abs(a[key][i]-b[key][i])<0.005,'Bounds changed beyond quantization tolerance');
console.log({trianglesByGroup:counts(optimized,true),meshes:optimized.getRoot().listMeshes().length,shadowCasters:optimized.getRoot().listNodes().filter(n=>n.getMesh()&&n.getExtras().shadowCaster).length});
