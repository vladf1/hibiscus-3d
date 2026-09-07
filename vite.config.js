import { posix } from "node:path";
import { defineConfig } from "vite";

const base = "/hibiscus-3d/";

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

export default defineConfig({
  base,
  plugins: [inlineViewer()],
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
