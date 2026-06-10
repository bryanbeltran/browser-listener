import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "copy-manifest",
      closeBundle() {
        copyFileSync("manifest.json", join("dist", "manifest.json"));
      },
    },
    {
      name: "relocate-popup",
      closeBundle() {
        const nested = join("dist", "src", "popup", "index.html");
        let html = readFileSync(nested, "utf8");
        // Asset paths from dist/popup.html (not dist/src/popup/)
        html = html.replace(/\.\.\/\.\.\//g, "./");
        writeFileSync(join("dist", "popup.html"), html);
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/index.ts"),
        content: resolve(__dirname, "src/content/index.ts"),
        popup: resolve(__dirname, "src/popup/index.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  publicDir: false,
});
