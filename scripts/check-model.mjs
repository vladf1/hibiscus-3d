import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readdir, readFile } from 'node:fs/promises';
import { getBounds, listTextureSlots } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const original = await io.read('project-files/hibiscus.glb');
const optimized = await io.read('assets/hibiscus.glb');
const core = await io.read('assets/hibiscus-core.glb');
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
assert.deepEqual(counts(core,true),counts(original,false),'Core model must keep every triangle');
// The core model differs only by normal-map previews; the streamed files restore the full images.
const images=doc=>new Map(doc.getRoot().listTextures().map(t=>[t.getName(),t]));
const full=images(optimized),previews=images(core);
const streamed=(await readdir('assets/textures')).map(file=>file.replace(/\.webp$/,'')).sort();
assert.deepEqual([...previews.keys()].sort(),[...full.keys()].sort(),'Core and full models must name the same textures');
assert.deepEqual([...previews.values()].filter(t=>listTextureSlots(t).includes('normalTexture')).map(t=>t.getName()).sort(),streamed,'Every core normal map needs a streamed full-size file');
for(const [name,texture] of full){
  const expected=Buffer.from(texture.getImage());
  if(streamed.includes(name))assert.ok(expected.equals(await readFile(`assets/textures/${name}.webp`)),`Streamed texture differs: ${name}`);
  else assert.ok(expected.equals(Buffer.from(previews.get(name).getImage())),`Core texture differs: ${name}`);
}
const a=getBounds(original.getRoot().listScenes()[0]);
for(const doc of [optimized,core]){const b=getBounds(doc.getRoot().listScenes()[0]);for(const key of ['min','max'])for(let i=0;i<3;i++)assert.ok(Math.abs(a[key][i]-b[key][i])<0.005,'Bounds changed beyond quantization tolerance');}
console.log({trianglesByGroup:counts(optimized,true),streamedTextures:streamed.length,meshes:optimized.getRoot().listMeshes().length,shadowCasters:optimized.getRoot().listNodes().filter(n=>n.getMesh()&&n.getExtras().shadowCaster).length});
