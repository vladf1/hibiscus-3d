import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

const root = new URL('../dist-cloudflare/', import.meta.url);
const htmlFile = new URL('index.html', root);
let html = await readFile(htmlFile, 'utf8');
const models = [...new Set(html.match(/\/assets\/[^"\s<>]+\.glb\b/g))];
if (models.length !== 1) throw new Error('Expected exactly one built model URL.');
const modelUrl = models[0];
const original = await readFile(new URL(modelUrl.slice(1), root));
const compressed = brotliCompressSync(original, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
});
if (!brotliDecompressSync(compressed).equals(original)) {
  throw new Error('Compressed model does not match the original.');
}
const hash = createHash('sha256').update(compressed).digest('hex').slice(0, 16);
const compressedUrl = `/assets/hibiscus-${hash}.glb.br`;
await writeFile(new URL(compressedUrl.slice(1), root), compressed);
html = html.replaceAll(modelUrl, compressedUrl);
await writeFile(htmlFile, html);
// An explicit Brotli representation: browsers decode it before GLTFLoader sees
// the bytes. Keep the ordinary GLB available at its original URL as well.
// no-transform prevents edge recompression of the precompressed payload.
await writeFile(new URL('_headers', root), `${compressedUrl}
  Content-Type: model/gltf-binary
  Content-Encoding: br
  Cache-Control: public, max-age=31536000, immutable, no-transform
`);
console.log(`Cloudflare model: ${original.length} → ${compressed.length} bytes (Brotli 11)`);
