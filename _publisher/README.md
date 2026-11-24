# Publisher

Shared SideRoad publisher, configured for aigiftpro.com. The full procedure for the scheduled task is the runbook `claude/aigiftpro-publishing-runbook.md` in the SideRoad Claude project.

- `publish.py` checks a post written as JSON and refuses anything that fails (quality, US English, SEO, AI-search structure, Amazon affiliate rules, duplicate content), then renders it with `template.html`, adds the card to `public/blog/index.html`, updates `public/sitemap.xml`, and rebuilds `public/llms.txt`.
- `site.json` is this site's config. `queue.json` is the topic queue. `posts.json` records what the publisher wrote.
- Never edit `publish.py`, `site.json` or `template.html` to get a post through. Fix the post.

```bash
python3 -I _publisher/publish.py status
python3 -I _publisher/publish.py check   post.json
python3 -I _publisher/publish.py publish post.json   # new guide
python3 -I _publisher/publish.py replace post.json   # rewrite an existing guide in place
```

Post JSON fields: slug, title, seo_title (65 chars max), primary_keyword, keywords[], meta_description (120 to 155), category (one of site.json categories), crumb, direct_answer (40 to 90 words), sections[{h2, body_html}], faqs[[q, a]], citations[], item_list[] (optional product names for ItemList schema).
