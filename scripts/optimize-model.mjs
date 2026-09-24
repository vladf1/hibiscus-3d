import { mkdir, rm, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, listTextureSlots, palette, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

// Always regenerate from the editable original, never recompress the runtime asset.
const maxSize = Number(process.env.TEXTURE_SIZE || 1024);
const quality = Number(process.env.TEXTURE_QUALITY || 80);
const previewSize = Number(process.env.PREVIEW_SIZE || 128);
if (process.env.KTX_EXPERIMENT && !process.argv[2]) throw new Error("KTX experiment requires an explicit output path.");
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const document = await io.read('project-files/hibiscus.glb');
const group = name => /dew.droplets/i.test(name) ? 'dew' : /Leaf|pedicel|stem|petiole/i.test(name) ? 'foliage' : 'flower';
const caster = name => /^Petal|serrated blade|throat|sepal/i.test(name);
for (const node of document.getRoot().listNodes()) {
  if (node.getMesh()) node.setExtras({ ...node.getExtras(), controlGroup: group(node.getName()), shadowCaster: caster(node.getName()) });
}
await document.transform(dedup(), palette(), flatten());
// Do not merge across visibility or shadow boundaries.
for (const controlGroup of ['flower', 'foliage', 'dew']) {
  for (const shadowCaster of [false, true]) {
    await document.transform(join({filter: node => node.getExtras().controlGroup === controlGroup && node.getExtras().shadowCaster === shadowCaster}));
  }
}
await document.transform(
  textureCompress({encoder: sharp, targetFormat: 'webp', resize: [maxSize,maxSize], quality, effort: 100, slots: process.env.KTX_EXPERIMENT ? /^(?!normalTexture$)/ : undefined}),
  ...(process.env.KTX_EXPERIMENT ? [textureCompress({encoder: sharp, targetFormat: 'png', resize: [maxSize,maxSize], slots: /^normalTexture$/})] : []),
  meshopt({encoder: MeshoptEncoder, level: 'high'}),
);
await io.write(process.argv[2] || 'assets/hibiscus.glb', document);
console.log(`Runtime model: ${document.getRoot().listMeshes().length} meshes; textures <= ${maxSize}px, WebP quality ${quality}.`);

// The viewer first loads a core model with small normal-map previews, then
// streams these full-resolution normal maps into the same material slots.
if (!process.argv[2]) {
  const normalMaps = document.getRoot().listTextures().filter(texture => listTextureSlots(texture).includes('normalTexture'));
  const names = new Set(normalMaps.map(texture => texture.getName()));
  if (names.size !== normalMaps.length || [...names].some(name => !/^[\w-]+$/.test(name))) {
    throw new Error('Normal maps need unique names that are safe as file names.');
  }
  await rm('assets/textures', {recursive: true, force: true});
  await mkdir('assets/textures');
  for (const texture of normalMaps) await writeFile(`assets/textures/${texture.getName()}.webp`, texture.getImage());
  await document.transform(
    textureCompress({encoder: sharp, targetFormat: 'webp', resize: [previewSize,previewSize], quality, effort: 100, slots: /^normalTexture$/}),
  );
  await io.write('assets/hibiscus-core.glb', document);
  console.log(`Core model: ${normalMaps.length} normal maps as ${previewSize}px previews; full size in assets/textures/.`);
}
