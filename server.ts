import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { generateRecommendations, friendlyError } from "./server/recommend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  // Minimal health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Public runtime config. The Gemini key is deliberately NOT here — it stays
  // on the server. The affiliate tag is public; it rides in every Amazon URL.
  app.get("/api/config", (req, res) => {
    res.json({
      VITE_AMAZON_AFFILIATE_TAG: process.env.VITE_AMAZON_AFFILIATE_TAG || process.env.AMAZON_AFFILIATE_TAG || "",
      APP_URL: process.env.APP_URL || ""
    });
  });

  // The AI call lives here, server-side, so the key is never shipped to the browser.
  app.post("/api/recommend", async (req, res) => {
    try {
      const data = await generateRecommendations(req.body);
      res.setHeader("Cache-Control", "no-store");
      res.json(data);
    } catch (err) {
      const { status, message } = friendlyError(err);
      console.error("recommend failed:", err);
      res.status(status).json({ message });
    }
  });

  // Serve robots.txt
  app.get("/robots.txt", (req, res) => {
    res.sendFile(path.join(process.cwd(), 'robots.txt'));
  });

  // Serve sitemap.xml
  app.get("/sitemap.xml", (req, res) => {
    res.sendFile(path.join(process.cwd(), 'sitemap.xml'));
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { maxAge: '1h' }));
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
