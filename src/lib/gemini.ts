import { RecipientInfo, GiftRecommendationResponse } from '../types';

/**
 * Ask our own server for recommendations.
 *
 * The Gemini call now happens server-side (server/recommend.ts), reached through
 * /api/recommend. The API key never reaches the browser, which also means the
 * key no longer needs its Google Cloud "website referrer" restriction removed.
 */
export async function getGiftRecommendations(
  info: RecipientInfo,
): Promise<GiftRecommendationResponse> {
  const res = await fetch('/api/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(info),
  });

  const ctype = res.headers.get('content-type') || '';

  if (!res.ok) {
    // If the response isn't JSON, the /api/recommend function isn't running at
    // all (e.g. a static-only deploy, or a build that didn't publish functions).
    if (!ctype.includes('application/json')) {
      throw new Error(
        "The gift engine isn't reachable. If this is a fresh deploy, make sure the site was built from Git (not a drag-and-drop zip) so the serverless function is live.",
      );
    }
    let message = "We couldn't put a list together just now. Give it another try.";
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {
      /* keep the friendly default */
    }
    throw new Error(message);
  }

  if (!ctype.includes('application/json')) {
    throw new Error(
      "The gift engine isn't reachable. If this is a fresh deploy, make sure the site was built from Git so the serverless function is live.",
    );
  }

  const data = (await res.json()) as GiftRecommendationResponse;
  if (!data?.recommendations?.length) {
    throw new Error("We couldn't put a list together just now. Give it another try.");
  }
  return data;
}
