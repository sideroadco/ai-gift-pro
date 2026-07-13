import { RecipientInfo, GiftRecommendationResponse } from '../types';

/**
 * Ask our own server for recommendations.
 *
 * The Gemini call happens server-side (server/recommend.ts), reached through
 * /api/recommend, so the API key never reaches the browser.
 *
 * IMPORTANT: this layer must never invent its own diagnosis. If the server
 * fails, show what the server actually said — a generic "unreachable" message
 * hides the real cause and sends people chasing deployment ghosts.
 */
export async function getGiftRecommendations(
  info: RecipientInfo,
): Promise<GiftRecommendationResponse> {
  let res: Response;
  try {
    res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(info),
    });
  } catch {
    // Only a genuine network failure lands here (offline, DNS, CORS).
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  const raw = await res.text();

  // Try to read the server's JSON, whether it succeeded or failed.
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* not JSON — handled below */
  }

  if (!res.ok) {
    // Prefer the server's own message. If the body wasn't JSON, the function
    // crashed or a proxy returned HTML — surface a trimmed excerpt so the real
    // problem is visible instead of masked.
    const serverMsg = parsed?.message;
    if (serverMsg) throw new Error(serverMsg);

    const excerpt = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(
      `The gift engine failed (HTTP ${res.status})${excerpt ? `: ${excerpt}` : '.'}`,
    );
  }

  if (!parsed) {
    throw new Error('The gift engine returned an unreadable response. Please try again.');
  }

  const data = parsed as GiftRecommendationResponse;
  if (!data?.recommendations?.length) {
    throw new Error("We couldn't put a list together just now. Give it another try.");
  }
  return data;
}
