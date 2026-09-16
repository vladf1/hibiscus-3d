// Local-only Vite preview with gzip matching the production transfer encoding.
import { preview } from 'vite';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4178);
const cache = new Map();
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
};

await preview({
  configFile: false,
  base: '/hibiscus-3d/',
  build: { outDir: root },
  preview: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'benchmark-gzip',
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
            .replace(/^\/hibiscus-3d\//, '');
          const file = resolve(root, pathname || 'index.html');
          if (!file.startsWith(root + '/')) return next();
          const { mtimeMs } = await stat(file);
          if (cache.get(file)?.mtimeMs !== mtimeMs) {
            cache.set(file, { mtimeMs, data: gzipSync(await readFile(file)) });
          }
          const { data } = cache.get(file);
          res.setHeader('Content-Type', mimeTypes[extname(file)] || 'application/octet-stream');
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Length', data.length);
          res.end(data);
        } catch {
          next();
        }
      });
    },
  }],
});
console.log(`Gzip Vite preview: http://127.0.0.1:${port}/hibiscus-3d/`);
