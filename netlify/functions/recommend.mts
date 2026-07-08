import type { Config, Context } from '@netlify/functions';
import { generateRecommendations, friendlyError } from '../../server/recommend';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const info = await req.json();
    const data = await generateRecommendations(info);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const { status, message } = friendlyError(err);
    console.error('recommend failed:', err);
    return new Response(JSON.stringify({ message }), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config: Config = { path: '/api/recommend' };
