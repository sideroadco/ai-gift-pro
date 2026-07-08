# Ai Gift Pro

Tell it who the gift is for and what they're into; get a short list of real
products, each with a reason it fits and a link to buy.

## Run it locally

```bash
npm install
cp .env.example .env      # then put your Gemini key in .env
npm run dev               # http://localhost:3000
```

You need a **Google AI Studio** API key (free, no credit card):
<https://aistudio.google.com>. Put it in `.env` as `GEMINI_API_KEY`.

The default model is `gemini-2.5-flash`, which is on Google's **free tier**.
Leave billing **disabled** on the Google Cloud project and the app costs nothing
to run. Set `GEMINI_MODEL` to switch models later without touching code.

## Deploy to Netlify (from Git — this is the one that works)

The site must be **built** by Netlify, so it has to come from a Git repo. A
drag-and-drop of the source zip will 404, because Netlify won't run the build.

1. Put these files at the **root of a Git repo** (GitHub/GitLab/Bitbucket) —
   `package.json`, `netlify.toml` and `index.html` must be at the top level,
   NOT inside an `ai-gift-pro/` subfolder.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
   It reads `netlify.toml` automatically: build `npm run build:web`, publish `dist`.
3. Add env vars in **Site settings → Environment variables**:
   `GEMINI_API_KEY`, `VITE_AMAZON_AFFILIATE_TAG` (= `gifts0b9-20`), and
   optionally `GEMINI_MODEL`.
4. Deploy. The homepage is static so it loads immediately; the "Find my gift"
   button uses the serverless function, which needs `GEMINI_API_KEY` set.

If your repo keeps everything inside an `ai-gift-pro/` subfolder, don't re-do it
— just set **Base directory = `ai-gift-pro`** in Netlify's build settings.

### Manual drag-and-drop (no Git)

Only works if YOU build first — Netlify won't build a dropped folder:

```bash
npm install
npm run build:web
```

Then drag the **`dist` folder** onto Netlify. Note: drag-drop can't run the
serverless function, so the homepage loads but "Find my gift" won't generate
results. Use the Git path for the full app.


## Deploy to a Node host (Render, Railway, Fly.io)

`npm run build && npm start` — `server.ts` serves `dist/` and exposes the same
two API routes.

## Where the API key lives

Server-side only, in `server/recommend.ts`. It is **not** inlined into the client
bundle and **not** returned by `/api/config`. Because the call is made from the
server, the key also doesn't need its Google Cloud "HTTP referrer" restriction
relaxed — restrict it by IP or leave it unrestricted for the server.

## Affiliate links

`src/lib/amazonUtils.ts` builds `amazon.com/dp/{ASIN}?tag={tag}` when the model
returned a verified ASIN, and falls back to `amazon.com/s?k={query}&tag={tag}`
otherwise — a search page always resolves, a hallucinated ASIN is a 404.

The tag comes from `VITE_AMAZON_AFFILIATE_TAG`, falling back to the built-in
`gifts0b9-20` with a console warning. Every buy button carries
`rel="sponsored noopener noreferrer"`, and the affiliate relationship is
disclosed in three places: the top bar, a band above the results, and under
every single card.
