import type { Config } from '@netlify/functions';

/**
 * Public runtime config. The affiliate tag is public by nature — it travels in
 * every outbound Amazon URL. The Gemini key is NOT here, and never should be.
 */
export default async () =>
  new Response(
    JSON.stringify({
      VITE_AMAZON_AFFILIATE_TAG:
        process.env.VITE_AMAZON_AFFILIATE_TAG || process.env.AMAZON_AFFILIATE_TAG || '',
      APP_URL: process.env.APP_URL || '',
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

export const config: Config = { path: '/api/config' };
