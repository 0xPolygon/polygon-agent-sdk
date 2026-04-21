import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { mirrorSkills } from './vite-plugins/mirror-skills';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), mirrorSkills()],
  server: {
    port: 4444
  }
});
