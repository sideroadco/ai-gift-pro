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
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function buildPrompt(info: RecipientInfo): string {
  const today = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return `
You are an expert personal shopper. Your reputation depends on ACCURACY.

TODAY'S DATE: ${today}

TASK: Recommend 12-15 specific gifts for this person.
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
3. ASIN HANDLING (this is the part people get wrong):
   - Use the Google Search tool to find the real 10-character Amazon.com ASIN.
   - Only return an ASIN you actually saw in a search result for THIS product.
   - If you did not see it, return exactly "SEARCH". Never guess.
   - A wrong ASIN sends the buyer to a 404. Three correct links beat ten broken ones.
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
      "searchQuery": "broad Amazon search term that returns results",
      "asin": "10-character ASIN, or SEARCH",
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

const ASIN_RE = /^[A-Z0-9]{10}$/;
const BAD_ASIN = /(AAAAA|BBBBB|12345|00000|B000000000|0123456789)/;

/** Never let a hallucinated ASIN through — a bad one is a 404 and a lost sale. */
function sanitize(raw: any): GiftRecommendationResponse {
  const list: GiftOption[] = Array.isArray(raw?.recommendations) ? raw.recommendations : [];
  const recommendations = list
    .filter((g) => g && typeof g.name === "string" && g.name.trim().length > 1)
    .map((g) => {
      const asin = String(g.asin ?? "").trim().toUpperCase();
      const valid = ASIN_RE.test(asin) && !BAD_ASIN.test(asin);
      return {
        name: String(g.name).trim(),
        description: String(g.description ?? "").trim(),
        priceRange: String(g.priceRange ?? "").trim(),
        whyItsPerfect: String(g.whyItsPerfect ?? "").trim(),
        searchQuery: String(g.searchQuery ?? g.name).trim(),
        // fall back to a search link, which always resolves to a real page
        asin: valid ? asin : "SEARCH",
        category: String(g.category ?? "Gift idea").trim(),
      } as GiftOption;
    });

  if (!recommendations.length) throw new Error("Model returned no usable recommendations");
  return { recommendations, summary: String(raw?.summary ?? "").trim() };
}

export async function generateRecommendations(info: RecipientInfo): Promise<GiftRecommendationResponse> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) throw new Error("MISSING_KEY");

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(info);

  // Grounded pass: Google Search is what lets the model find real ASINs.
  // Note: Gemini does not accept responseSchema/responseMimeType together with
  // tools, so we ask for raw JSON in the prompt and parse defensively.
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] as any },
    });
    const text = res.text;
    if (!text) throw new Error("Empty response from model");
    return sanitize(extractJson(text));
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/API key|API_KEY|PERMISSION_DENIED|invalid/i.test(msg)) throw new Error("BAD_KEY");
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) throw new Error("RATE_LIMIT");

    // Ungrounded fallback: still returns ideas, but every link becomes a search
    // link because no ASIN was verified. Better than a dead end.
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: prompt + "\n\nYou have no search tool. Set every \"asin\" to \"SEARCH\".",
      config: { responseMimeType: "application/json" },
    });
    const text = res.text;
    if (!text) throw new Error("Empty response from model");
    return sanitize(extractJson(text));
  }
}

/** Map internal errors to something safe and human. Never leak key details. */
export function friendlyError(err: unknown): { status: number; message: string } {
  const code = String((err as any)?.message ?? err);
  if (code === "MISSING_KEY")
    return { status: 500, message: "The gift engine isn't configured yet. Set GEMINI_API_KEY on the server." };
  if (code === "BAD_KEY")
    return { status: 500, message: "The gift engine couldn't authenticate. Check the server's GEMINI_API_KEY." };
  if (code === "RATE_LIMIT")
    return { status: 429, message: "We've hit today's free-tier limit. Try again in a little while." };
  return { status: 502, message: "We couldn't put a list together just now. Give it another try." };
}
