import { posix } from "node:path";
import { gzipSync } from "node:zlib";
import { defineConfig } from "vite";

const base = process.env.DEPLOY_BASE || "/hibiscus-3d/";

// Run after Vite has minified the entry and generated its HTML script tag.
function inlineViewer() {
  return {
    name: "inline-viewer",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const html = bundle["index.html"];
        const entry = Object.values(bundle).find(
          (file) => file.type === "chunk" && file.isEntry,
        );
        if (!html || !entry) this.error("Missing viewer HTML or entry chunk.");

        // Inline modules resolve imports from the HTML, not the assets folder.
        // Use the parser's exact string spans rather than matching JavaScript text.
        let code = entry.code;
        const imports = this.parse(code).body.filter(
          (node) => node.type === "ImportDeclaration",
        );
        for (const { source } of imports.reverse()) {
          if (!source.value.startsWith(".")) continue;
          const url = posix.join(
            base,
            posix.dirname(entry.fileName),
            source.value,
          );
          code =
            code.slice(0, source.start) +
            JSON.stringify(url) +
            code.slice(source.end);
        }

        // Keep string contents from terminating the surrounding HTML script tag.
        code = code.replace(/<\/script/gi, "<\\/script");
        let embedded = false;
        html.source = String(html.source).replace(
          /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
          (tag, src) => {
            if (src !== base + entry.fileName) return tag;
            embedded = true;
            return `<script type="module">${code}</script>`;
          },
        );
        if (!embedded)
          this.error("Could not find the built viewer script tag.");
        delete bundle[entry.fileName];
      },
    },
  };
}

// GitHub Pages compresses by content type, which may exclude GLB files. Ship the
// core model as explicit gzip; the viewer inflates it with DecompressionStream.
function gzipCoreModel() {
  return {
    name: "gzip-core-model",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const html = bundle["index.html"];
        const model = Object.values(bundle).find(
          (file) =>
            file.type === "asset" &&
            /^assets\/hibiscus-core-[\w-]+\.glb$/.test(file.fileName),
        );
        if (!html || !model) this.error("Missing viewer HTML or core model.");
        const preload = String(html.source).match(/<link id="model-preload"[^>]*>/)?.[0];
        if (!preload?.includes(`href="${base + model.fileName}"`))
          this.error("Could not find the core model preload.");
        const fileName = `${model.fileName}.gz`;
        // Only browsers that can inflate the core model preload it. The others
        // load the full model instead and would never use this download.
        const link = JSON.stringify({
          id: "model-preload",
          rel: "preload",
          as: "fetch",
          crossOrigin: "anonymous",
          href: base + fileName,
        });
        html.source = String(html.source).replace(
          preload,
          `<script>if(self.DecompressionStream)document.head.append(Object.assign(document.createElement("link"),${link}))</script>`,
        );
        delete bundle[model.fileName];
        this.emitFile({
          type: "asset",
          fileName,
          source: gzipSync(model.source, { level: 9 }),
        });
      },
    },
  };
}

export default defineConfig({
  base,
  plugins: [inlineViewer(), gzipCoreModel()],
  build: {
    minify: true,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three-vendor", test: /[\\/]node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
});
