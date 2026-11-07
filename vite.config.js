import { defineConfig } from 'vite'

// Static assets (logo, favicons) live in public/assets and are served at /assets/*.
export default defineConfig({
  build: { target: 'es2020', sourcemap: false }
})
