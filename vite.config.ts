import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  
  // NOTE: the Gemini key is intentionally NOT defined here. Anything placed in
  // `define` is inlined into the client bundle and readable by anyone. The key
  // is used only server-side (server/recommend.ts).
  const affiliateTag = env.VITE_AMAZON_AFFILIATE_TAG || env.AMAZON_AFFILIATE_TAG || "";
  if (!affiliateTag) {
    console.warn("[ai-gift-pro] VITE_AMAZON_AFFILIATE_TAG is not set — falling back to the documented default.");
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.APP_URL': JSON.stringify(env.APP_URL || ""),
      'process.env.VITE_AMAZON_AFFILIATE_TAG': JSON.stringify(affiliateTag),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
