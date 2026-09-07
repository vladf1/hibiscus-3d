import { defineConfig } from "vite";

export default defineConfig({
  base: "/hibiscus-3d/",
  build: {
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
