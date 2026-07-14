/**
 * Server-side gift recommendation.
 *
 * This module NEVER runs in the browser. It is imported by:
 *   - server.ts                     (local dev / any Node host)
 *   - netlify/functions/recommend   (Netlify serverless)
 *
 * That means GEMINI_API_KEY stays on the server. It is never bundled into the
 * client and never returned by /api/config.
 */
import { GoogleGenAI } from "@google/genai";
import type { RecipientInfo, GiftOption, GiftRecommendationResponse } from "../src/types";

/**
 * Default model is a FREE-TIER model, so the app costs nothing to run on a
 * Google AI Studio key (leave billing disabled on the project).
 *   Free tier : gemini-2.5-flash (default), gemini-3.1-flash-lite
 *   Paid only : gemini-3.1-pro-preview
 * Override with the GEMINI_MODEL environment variable.
 */
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

function buildPrompt(info: RecipientInfo): string {
  const today = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return `
You are an expert personal shopper. Your reputation depends on ACCURACY.

TODAY'S DATE: ${today}

TASK: Recommend exactly 6 specific gifts for this person.
- Relationship to buyer: ${info.relationship || "unspecified"}
- Age: ${info.age || "unspecified"}
- Occasion: ${info.occasion || "unspecified"}
- Budget: ${info.budget || "unspecified"}
- Interests / hobbies: ${info.interests || "unspecified"}
- Personality: ${info.personality || "unspecified"}

STRICT RULES
1. REAL PRODUCTS ONLY. Every gift must be something a person can buy today.
   Never invent a product, a brand, or a model number.
2. BE SPECIFIC. "Ember Mug 2" or "Leuchtturm1917 A5" — not "a nice mug".
   Skip the obvious mug-and-socks defaults unless the brand makes it interesting.
3. LINKING. Do NOT provide Amazon product codes (ASINs) — we never use them,
   because a guessed code sends the buyer to a dead page. Instead, give a
   "searchQuery" that is precise enough that the product is the top result on
   Amazon: include the brand and the model/edition, and nothing else.
   Good: "Fellow Stagg EKG electric kettle"
   Bad:  "nice kettle for coffee lovers"
4. PRICE. priceRange is your best estimate (e.g. "$40 - $60"). It is shown to the
   user as an estimate, not as a live Amazon price.

OUTPUT
Return RAW JSON only. No markdown, no code fences, no commentary before or after.
Shape:
{
  "summary": "2-3 sentences explaining the strategy behind this list",
  "recommendations": [
    {
      "name": "string",
      "description": "string, 1-2 sentences, concrete",
      "priceRange": "string",
      "whyItsPerfect": "string, one sentence tied to THIS person",
      "searchQuery": "precise Amazon search: brand + model, so the product is the top hit",
      "category": "short label, e.g. For the reader"
    }
  ]
}`.trim();
}

/** Pull a JSON object out of a model response that may be fenced or padded. */
function extractJson(text: string): any {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object in model response");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

/**
 * We do NOT use model-supplied ASINs. A hallucinated code looks perfectly valid
 * (10 chars, right alphabet) but lands on "Sorry, we couldn't find that page" —
 * a dead link loses the sale and the trust. Every link is therefore an Amazon
 * SEARCH link, which always resolves and still carries the affiliate tag, so
 * tracking and commissions are unaffected.
 */
function sanitize(raw: any): GiftRecommendationResponse {
  const list: GiftOption[] = Array.isArray(raw?.recommendations) ? raw.recommendations : [];
  const recommendations = list
    .filter((g) => g && typeof g.name === "string" && g.name.trim().length > 1)
    .map((g) => {
      return {
        name: String(g.name).trim(),
        description: String(g.description ?? "").trim(),
        priceRange: String(g.priceRange ?? "").trim(),
        whyItsPerfect: String(g.whyItsPerfect ?? "").trim(),
        searchQuery: String(g.searchQuery ?? g.name).trim(),
        // Always a search link. Never a model-supplied product code.
        asin: "SEARCH",
        category: String(g.category ?? "Gift idea").trim(),
      } as GiftOption;
    });

  if (!recommendations.length) throw new Error("Model returned no usable recommendations");
  return { recommendations, summary: String(raw?.summary ?? "").trim() };
}

/** Reject before Netlify's function limit so the user gets a readable message
 *  instead of an opaque 504 gateway timeout. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("SLOW")), ms)),
  ]);
}

export async function generateRecommendations(info: RecipientInfo): Promise<GiftRecommendationResponse> {
  // Read the key across runtimes. On Netlify, prefer the value the user set.
  // (Netlify's AI Gateway can inject its own Gemini vars; we deliberately use
  // the user's GEMINI_API_KEY and talk to Google directly.)
  const g: any = (globalThis as any).Netlify?.env;
  const apiKey =
    (g?.get?.("GEMINI_API_KEY")) ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";
  if (!apiKey) throw new Error("MISSING_KEY");

  // Pin transport to Google's public endpoint so no injected base URL/gateway
  // intercepts the request. This is what makes the free-tier key work on Netlify.
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { baseUrl: "https://generativelanguage.googleapis.com" },
  } as any);
  const prompt = buildPrompt(info);

  // No search grounding. It roughly triples the latency and Netlify's function
  // timeout (10s on the free plan) kills the request before it returns — that was
  // the HTTP 504. We don't need grounding any more: every link is an Amazon
  // search link, so the model never has to look up a product code.
  try {
    const res = await withTimeout(
      ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      }),
      8500, // finish before Netlify's 10s function limit, so we can return a real message
    );
    const text = res.text;
    if (!text) throw new Error("Empty response from model");
    return sanitize(extractJson(text));
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "SLOW") throw new Error("SLOW");
    if (/API key|API_KEY|PERMISSION_DENIED|invalid/i.test(msg)) throw new Error("BAD_KEY");
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) throw new Error("RATE_LIMIT");
    // No retry here: a second call would blow the timeout budget and turn a
    // readable error into an opaque 504.
    throw err;
  }
}

/** Map internal errors to something safe and human. Never leak key details. */
export function friendlyError(err: unknown): { status: number; message: string } {
  const code = String((err as any)?.message ?? err);
  if (code === "MISSING_KEY")
    return { status: 500, message: "The gift engine isn't configured yet. Set GEMINI_API_KEY on the server." };
  if (code === "BAD_KEY")
    return { status: 500, message: "The gift engine couldn't authenticate. Check the server's GEMINI_API_KEY." };
  if (code === "SLOW")
    return { status: 504, message: "That took too long to put together. Please try again — it's usually faster the second time." };
  if (code === "RATE_LIMIT")
    return { status: 429, message: "We've hit today's free-tier limit. Try again in a little while." };
  // Surface the underlying reason (trimmed) so problems are diagnosable in the UI
  // and logs, rather than a blanket "not reachable".
  const detail = code.replace(/\s+/g, " ").slice(0, 300);
  return { status: 502, message: `The gift engine returned an error: ${detail}` };
}
