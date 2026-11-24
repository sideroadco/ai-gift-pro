#!/usr/bin/env python3
"""SideRoad shared publisher.

Claude researches and writes a post as JSON; this script checks it and refuses to publish
anything that fails. One copy lives in each site repo at _publisher/, configured by
_publisher/site.json and rendered through _publisher/template.html.

    python3 -I _publisher/publish.py check   post.json   # run every check, write nothing
    python3 -I _publisher/publish.py publish post.json   # check, then publish a new post
    python3 -I _publisher/publish.py replace post.json   # check, then rewrite an existing post in place
    python3 -I _publisher/publish.py status              # posts, legacy posts left to refresh, queue
    python3 -I _publisher/publish.py llms                # rebuild llms.txt

Never edit this file or site.json to get a post through. Fix the post.
"""
import html as _html
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

PUB = Path(__file__).resolve().parent
ROOT = PUB.parent
CFG = json.loads((PUB / 'site.json').read_text(encoding='utf-8'))
DOMAIN = CFG['domain'].rstrip('/')
BLOG = ROOT / CFG['blog_dir']
REGISTRY = PUB / 'posts.json'

BANNED_WORDS = ['delve', 'tapestry', 'realm', 'multifaceted', 'seamless', 'elevate', 'unlock',
                'robust', 'foster', 'revolutionize', 'transformative', 'game-changing', 'game changing',
                'cutting-edge', 'paradigm', 'synergy', 'holistic', 'leverage', 'look no further']
BANNED_PHRASES = ["in today's fast-paced world", "let's dive in", "here's the thing", "the bottom line",
                  "it is important to note", "it's important to note", "whether you're", "in conclusion",
                  "it's not just", "navigating the", "when it comes to"]
UK_SPELLINGS = ['colour', 'favourite', 'flavour', 'jewellery', 'mum ', "mum's", 'mums ', 'organis', 'optimis',
                'realis', 'recognis', 'apologis', 'centre', 'theatre', 'cheque', 'programme', 'travelling',
                'cosy', 'whilst', 'aluminium', 'pyjama', 'nappy', 'nappies', 'trainers', 'postcode',
                'fortnight', 'learnt', 'behaviour', 'honour',
                'neighbour', 'humour', 'catalogue', 'defence', 'licence', 'tyre']


# ---------------------------------------------------------------- helpers
def load_json(p, default):
    p = Path(p)
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else default


def esc(s):
    return _html.escape(s, quote=True)


def text(h):
    return _html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h))).strip()


def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:60]


def shingles(t, n=5):
    w = re.findall(r"[a-z0-9$']+", t.lower())
    return {' '.join(w[i:i + n]) for i in range(max(0, len(w) - n + 1))}


def post_path(slug):
    return BLOG / slug / 'index.html' if CFG.get('url_style', 'dir') == 'dir' else BLOG / f'{slug}.html'


def post_url(slug):
    base = f"{DOMAIN}/{CFG['blog_dir_url'].strip('/')}"
    return f"{base}/{slug}/" if CFG.get('url_style', 'dir') == 'dir' else f"{base}/{slug}.html"


def existing_posts():
    out = {}
    if CFG.get('url_style', 'dir') == 'dir':
        for p in BLOG.glob('*/index.html'):
            out[p.parent.name] = p
    else:
        for p in BLOG.glob('*.html'):
            if p.name != 'index.html':
                out[p.stem] = p
    return out


def main_text(page):
    m = re.search(r'(?s)<article[^>]*>(.*?)</article>', page) or re.search(r'(?s)<main[^>]*>(.*?)</main>', page)
    body = m.group(1) if m else page
    body = re.sub(r'(?s)<(script|style|nav|aside|footer)\b.*?</\1>', ' ', body)
    return text(body)


def internal_exists(href):
    path = urlparse(href).path
    if path in ('', '/'):
        return True
    for base in [ROOT / d for d in CFG.get('public_dirs', ['.'])]:
        p = path.lstrip('/')
        for c in (p, p.rstrip('/') + '/index.html', p + '.html', p + '/index.html'):
            if (base / c).is_file():
                return True
    return path.rstrip('/') in [r.rstrip('/') for r in CFG.get('app_routes', [])]


def amazon_fix(href):
    """Force our tag onto every Amazon link. Returns (new_href, ok)."""
    tag = CFG.get('affiliate', {}).get('amazon_tag')
    u = urlparse(href)
    if 'amazon.' not in u.netloc:
        return href, True
    if u.netloc not in ('www.amazon.com', 'amazon.com'):
        return href, False
    q = parse_qs(u.query)
    q['tag'] = [tag]
    for junk in ('ref', 'ref_', 'psc', 'th', 'linkCode', 'linkId', 'language'):
        q.pop(junk, None)
    return urlunparse(u._replace(netloc='www.amazon.com', query=urlencode(q, doseq=True))), True


def normalize_links(h):
    def fix(m):
        attrs = m.group(1)
        hm = re.search(r'href="([^"]+)"', attrs)
        if not hm:
            return m.group(0)
        href = hm.group(1)
        if 'amazon.' in href:
            new, _ = amazon_fix(href)
            attrs = attrs.replace(hm.group(0), f'href="{esc(_html.unescape(new))}"')
            attrs = re.sub(r'\s*rel="[^"]*"', '', attrs) + ' rel="sponsored nofollow noopener" target="_blank"'
        elif href.startswith('http') and urlparse(href).netloc not in (urlparse(DOMAIN).netloc,):
            if 'rel=' not in attrs:
                attrs += ' rel="noopener"'
        return f'<a{attrs}>'
    return re.sub(r'<a(\s[^>]*)>', fix, h)


# ---------------------------------------------------------------- checks
def check(post, replace=False):
    P, W = [], []
    posts = existing_posts()
    slug = post.get('slug', '')
    if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', slug or 'x!'):
        P.append('slug must be lowercase words joined by hyphens')
    if replace and slug not in posts:
        P.append(f'replace: no existing post {slug}')
    if not replace and slug in posts:
        P.append(f'{slug} already exists; use replace to rewrite it')
    for k in ('title', 'seo_title', 'primary_keyword', 'keywords', 'meta_description', 'category',
              'direct_answer', 'sections', 'faqs', 'citations'):
        if not post.get(k):
            P.append(f'missing field: {k}')
    if P:
        return P, W
    title, seo = post['title'], post['seo_title']
    if len(seo) + len(CFG.get('title_suffix', '')) > 65:
        P.append(f'title tag is {len(seo) + len(CFG.get("title_suffix", ""))} chars; 65 max')
    md = post['meta_description']
    if not 120 <= len(md) <= 155:
        P.append(f'meta_description is {len(md)} chars; must be 120 to 155')
    for s, p in posts.items():
        if s == slug:
            continue
        m = re.search(r'<meta name="description" content="([^"]*)"', p.read_text(encoding='utf-8', errors='ignore'))
        if m and _html.unescape(m.group(1)).strip().lower() == md.strip().lower():
            P.append(f'meta_description duplicates /{s}')
    if post['category'] not in CFG.get('categories', [post['category']]):
        P.append(f"category must be one of {CFG.get('categories')}")

    da = text(post['direct_answer'])
    if not 40 <= len(da.split()) <= 90:
        P.append(f'direct_answer is {len(da.split())} words; 40 to 90, first sentence answers the title')
    if post['primary_keyword'].lower() not in da.lower():
        W.append('primary_keyword is not in the direct answer')
    if post['primary_keyword'].lower() not in (title + ' ' + seo).lower():
        W.append('primary_keyword is not in the title')

    secs = post['sections']
    if len(secs) < CFG.get('min_sections', 5):
        P.append(f'{len(secs)} sections; need {CFG.get("min_sections", 5)}+')
    if sum(1 for s in secs if s['h2'].strip().endswith('?')) < 2:
        P.append('at least 2 section headings must be phrased as the questions people search')
    body = ' '.join(s['body_html'] for s in secs)
    btxt = text(body)
    minw = CFG.get('min_words', 1300)
    if len(btxt.split()) < minw:
        P.append(f'body is {len(btxt.split())} words; need {minw}+')
    for para in re.findall(r'(?s)<p>(.*?)</p>', body):
        if len(text(para).split()) > 120:
            P.append(f'paragraph over 120 words: {text(para)[:60]}...')
    if '<table' not in body and '<ol' not in body:
        W.append('no table or numbered list; AI answers and snippets favour them')

    faqs = post['faqs']
    if len(faqs) < 4:
        P.append(f'{len(faqs)} FAQs; need 4+')
    for q, a in faqs:
        if not q.strip().endswith('?'):
            P.append(f'FAQ is not a question: {q[:50]}')
        if len(text(a)) < 150:
            P.append(f'FAQ answer under 150 chars: {q[:50]}')

    allhtml = ' '.join([title, seo, md, post['direct_answer'], body] + [q + ' ' + a for q, a in faqs])
    plain = text(allhtml)
    low = ' ' + plain.lower() + ' '
    if '—' in allhtml or '–' in allhtml or '&mdash;' in allhtml or '&ndash;' in allhtml:
        P.append('contains an em or en dash')
    for w in BANNED_WORDS:
        if re.search(r'\b' + re.escape(w) + r'\b', low):
            P.append(f'banned word: {w}')
    for ph in BANNED_PHRASES:
        if ph in low:
            P.append(f'banned phrase: {ph}')
    if CFG.get('locale', 'en-US') == 'en-US':
        if '£' in plain or '&pound;' in allhtml:
            P.append('uses £; this site writes for US readers in $')
        for w in UK_SPELLINGS:
            if w in low:
                P.append(f"UK spelling or term '{w.strip()}'; write US English")
    for m in re.finditer(r"\b[Aa] (?=[AEIOU][a-z])\w+", plain):
        P.append(f"article error: '{m.group(0)}'")
    tight = _html.unescape(re.sub(r'<[^>]+>', '', allhtml))
    ms = re.search(r'\w\s+[,.;:](?!\w)', tight)
    if ms:
        P.append(f"stray space before punctuation: '...{tight[max(0, ms.start() - 20):ms.end() + 3]}'")
    for bad in CFG.get('forbidden_strings', []):
        if bad.lower() in low:
            P.append(f'forbidden on this site: {bad}')

    blocks = re.findall(r'(?s)<(p|li|td)\b[^>]*>(.*?)</\1>', body)
    if not post.get('allow_stats'):
        for _, b in blocks:
            bt = text(b)
            if re.search(r'\d+(\.\d+)?\s?(%|percent\b)', bt) and not re.search(r'href="https?://(?!www\.amazon)', b):
                P.append(f'percentage without a source link in the same paragraph: {bt[:70]}')
            if re.search(r'\b(study|survey|research|report)\b\s+(by|from|found|shows)', bt, re.I) and not re.search(r'href="https?://(?!www\.amazon)', b):
                P.append(f'study claim without a source link: {bt[:70]}')

    hrefs = re.findall(r'href="([^"]+)"', body + ' '.join(a for _, a in faqs))
    internal = [h for h in hrefs if h.startswith('/')]
    amazon = [h for h in hrefs if 'amazon.' in h]
    external = [h for h in hrefs if h.startswith('http') and 'amazon.' not in h and urlparse(DOMAIN).netloc not in h]
    if len(set(internal)) < 3:
        P.append(f'{len(set(internal))} internal links; need 3+ to real pages on this site')
    for h in set(internal):
        if not internal_exists(h):
            P.append(f'dead internal link: {h}')
    need_src = CFG.get('min_source_links', 2)
    if len(set(external)) < need_src:
        P.append(f'{len(set(external))} outbound source links; need {need_src}+ to primary or authoritative sources')
    aff = CFG.get('affiliate', {})
    if aff.get('amazon_tag'):
        need = aff.get('min_amazon_links', 0)
        if len(amazon) < need:
            P.append(f'{len(amazon)} Amazon links; this site needs {need}+ genuinely relevant product links')
        for h in amazon:
            if not ('amazon.com/dp/' in h or 'amazon.com/s?' in h or 'amazon.com/gp/product/' in h):
                P.append(f'Amazon link must be a /dp/ASIN product page or a /s?k= search: {h[:80]}')
            if 'amazon.co.uk' in h or 'amazon.ca' in h:
                P.append(f'non-US Amazon link: {h[:60]}')
        for _, b in blocks:
            if 'amazon.' in b and re.search(r'\$\s?\d+\.\d{2}', text(b)):
                P.append('exact product price next to an Amazon link; Amazon forbids showing prices you did not fetch live. Use budget ranges instead')
    if not post.get('citations'):
        P.append('citations list is empty')

    for f in CFG.get('required_mentions', []):
        if f.lower() not in low:
            P.append(f'must mention: {f}')

    new = shingles(btxt)
    worst, ws = 0.0, None
    for s, p in posts.items():
        if s == slug:
            continue
        sh = shingles(main_text(p.read_text(encoding='utf-8', errors='ignore')))
        if sh and new:
            j = len(new & sh) / len(new | sh)
            if j > worst:
                worst, ws = j, s
    post['_similarity'] = (round(worst, 3), ws)
    if worst >= CFG.get('similarity_max', 0.08):
        P.append(f'too similar to /{ws} (5-gram Jaccard {worst:.3f}, max {CFG.get("similarity_max", 0.08)})')
    return P, W


# ---------------------------------------------------------------- render
def render(post, published_iso, modified_iso):
    t = CFG['snippets']
    slug, url = post['slug'], post_url(post['slug'])
    secs = post['sections']
    toc, body = [], ''
    for i, s in enumerate(secs):
        a = s.get('anchor') or slugify(s['h2']) or f's{i}'
        toc.append(t['toc_item'].replace('{{ANCHOR}}', a).replace('{{TEXT}}', esc(s['h2'])))
        body += f'<h2 id="{a}">{esc(s["h2"])}</h2>\n{normalize_links(s["body_html"])}\n\n'
    toc.append(t['toc_item'].replace('{{ANCHOR}}', 'faq').replace('{{TEXT}}', esc(CFG.get('faq_heading', 'Frequently asked questions'))))
    faq_items = ''.join(t['faq_item'].replace('{{Q}}', esc(q)).replace('{{A}}', normalize_links(a if a.lstrip().startswith('<') else f'<p>{esc(a)}</p>')) for q, a in post['faqs'])
    faq_html = t['faq_wrap'].replace('{{HEADING}}', esc(CFG.get('faq_heading', 'Frequently asked questions'))).replace('{{ITEMS}}', faq_items)

    # related: most similar existing posts (but not near-duplicates)
    new = shingles(text(' '.join(s['body_html'] for s in secs)))
    reg = load_json(REGISTRY, {'posts': {}})['posts']
    scored = []
    for s, p in existing_posts().items():
        if s == slug:
            continue
        page = p.read_text(encoding='utf-8', errors='ignore')
        tm = re.search(r'<h1[^>]*>(.*?)</h1>', page, re.S)
        sh = shingles(main_text(page))
        j = len(new & sh) / len(new | sh) if sh and new else 0
        cat = reg.get(s, {}).get('category') or ''
        scored.append((j + (0.05 if cat == post['category'] else 0), s, text(tm.group(1)) if tm else s, cat))
    scored.sort(reverse=True)
    rel = ''.join(t['related_item'].replace('{{URL}}', post_url(s).replace(DOMAIN, '')).replace('{{TITLE}}', esc(tt)).replace('{{CATEGORY}}', esc(c or post['category'])) for _, s, tt, c in scored[:3])

    words = len(text(body).split())
    read_min = max(3, round(words / 230))
    faq_schema = [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": text(a)}} for q, a in post['faqs']]
    graph = [
        {"@type": "BlogPosting", "@id": f"{url}#article", "headline": post['title'], "description": post['meta_description'],
         "datePublished": published_iso, "dateModified": modified_iso, "inLanguage": CFG.get('locale', 'en-US'),
         "wordCount": words, "keywords": ", ".join(post['keywords']), "articleSection": post['category'],
         "author": {"@type": "Organization", "name": CFG['site_name'], "url": DOMAIN + '/'},
         "publisher": {"@type": "Organization", "name": CFG['site_name'], "url": DOMAIN + '/',
                       "logo": {"@type": "ImageObject", "url": DOMAIN + CFG.get('logo', '/favicon.png')}},
         "image": DOMAIN + CFG.get('share_image', CFG.get('logo', '/favicon.png')),
         "mainEntityOfPage": {"@type": "WebPage", "@id": url},
         "citation": post['citations'], "timeRequired": f"PT{read_min}M"},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": DOMAIN + '/'},
            {"@type": "ListItem", "position": 2, "name": CFG.get('blog_name', 'Blog'), "item": f"{DOMAIN}/{CFG['blog_dir_url'].strip('/')}/"},
            {"@type": "ListItem", "position": 3, "name": post.get('crumb') or post['title'], "item": url}]},
        {"@type": "FAQPage", "@id": f"{url}#faq", "mainEntity": faq_schema},
        {"@type": "WebPage", "@id": url, "url": url, "name": post['title'],
         "speakable": {"@type": "SpeakableSpecification", "cssSelector": [CFG.get('answer_selector', '.answer-box')]}},
    ]
    if post.get('item_list'):
        graph.append({"@type": "ItemList", "name": post['title'], "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": n} for i, n in enumerate(post['item_list'])]})
    jsonld = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False).replace('</', '<\\/')
    pub_dt = datetime.fromisoformat(published_iso)
    mod_dt = datetime.fromisoformat(modified_iso)
    human = ('Updated ' if modified_iso != published_iso else 'Published ') + mod_dt.strftime('%B %-d, %Y')
    page = (PUB / 'template.html').read_text(encoding='utf-8')
    rep = {
        '{{TITLE_TAG}}': esc(post['seo_title'] + CFG.get('title_suffix', '')),
        '{{META_DESCRIPTION}}': esc(post['meta_description']),
        '{{CANONICAL}}': url,
        '{{OG_TITLE}}': esc(post['title']),
        '{{SHARE_IMAGE}}': DOMAIN + CFG.get('share_image', CFG.get('logo', '/favicon.png')),
        '{{PUBLISHED_ISO}}': published_iso, '{{MODIFIED_ISO}}': modified_iso,
        '{{JSONLD}}': jsonld,
        '{{CATEGORY}}': esc(post['category']),
        '{{CRUMB}}': esc(post.get('crumb') or post['title']),
        '{{H1}}': esc(post['title']),
        '{{DATE_ISO}}': mod_dt.strftime('%Y-%m-%d'), '{{DATE_HUMAN}}': human, '{{READ_MIN}}': str(read_min),
        '{{DIRECT_ANSWER}}': normalize_links(post['direct_answer'] if post['direct_answer'].lstrip().startswith('<') else f'<p>{post["direct_answer"]}</p>'),
        '{{TOC}}': t['toc_wrap'].replace('{{ITEMS}}', ''.join(toc)),
        '{{BODY}}': body, '{{FAQ}}': faq_html, '{{RELATED}}': rel,
    }
    for k, v in rep.items():
        page = page.replace(k, v)
    left = re.findall(r'\{\{[A-Z_]+\}\}', page)
    if left:
        sys.exit(f'template placeholders not filled: {left}')
    return page, words


def update_index(post, replace):
    ix = ROOT / CFG['index']['path']
    if not ix.exists():
        return
    h = ix.read_text(encoding='utf-8')
    url_path = post_url(post['slug']).replace(DOMAIN, '')
    card = (CFG['snippets']['card'].replace('{{URL}}', url_path).replace('{{TITLE}}', esc(post['title']))
            .replace('{{CATEGORY}}', esc(post['category'])).replace('{{EXCERPT}}', esc(post['meta_description'][:160]))
            .replace('{{DATE_ISO}}', datetime.now().strftime('%Y-%m-%d')))
    if replace:
        h = re.sub(r'<li class="card"><a href="' + re.escape(url_path) + r'">.*?</a></li>', card, h, count=1, flags=re.S)
    else:
        mode = CFG['index'].get('mode', 'marker')
        if mode == 'category-sections':
            m = re.search(r'(<section class="cat"><h2>' + re.escape(esc(post['category'])) + r'</h2><ul class="cards">)', h)
            if m:
                h = h[:m.end()] + card + h[m.end():]
            else:
                first = h.find('<section class="cat">')
                new = f'<section class="cat"><h2>{esc(post["category"])}</h2><ul class="cards">{card}</ul></section>'
                h = h[:first] + new + h[first:]
        else:
            marker = CFG['index']['marker']
            if marker not in h:
                sys.exit(f'index marker {marker} missing from {ix}')
            h = h.replace(marker, marker + '\n' + card, 1)
    ix.write_text(h, encoding='utf-8')


def update_sitemap(post):
    for sm in CFG.get('sitemaps', []):
        p = ROOT / sm
        if not p.exists():
            continue
        h = p.read_text(encoding='utf-8')
        url = post_url(post['slug'])
        today = datetime.now().strftime('%Y-%m-%d')
        if f'<loc>{url}</loc>' in h:
            h = re.sub(r'(<loc>' + re.escape(url) + r'</loc>\s*<lastmod>)[^<]*', r'\g<1>' + today, h)
        else:
            h = h.replace('</urlset>', f'  <url><loc>{url}</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>\n</urlset>')
        p.write_text(h, encoding='utf-8')


def write_llms():
    cfg = CFG.get('llms', {})
    lines = [f"# {CFG['site_name']}", '', f"> {cfg.get('summary', '')}", '', '## Key pages', '']
    lines += [f"- [{n}]({DOMAIN}{u}): {d}" for n, u, d in cfg.get('key_pages', [])]
    lines += ['', f"## {CFG.get('blog_name', 'Guides')}", '']
    for s, p in sorted(existing_posts().items()):
        h = p.read_text(encoding='utf-8', errors='ignore')
        t = re.search(r'<h1[^>]*>(.*?)</h1>', h, re.S)
        d = re.search(r'<meta name="description" content="([^"]*)"', h)
        if t:
            lines.append(f"- [{text(t.group(1))}]({post_url(s)})" + (f": {_html.unescape(d.group(1))}" if d else ''))
    out = ROOT / CFG.get('llms_path', 'llms.txt')
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return len(lines)


def run(mode, path):
    post = json.loads(Path(path).read_text(encoding='utf-8'))
    post['faqs'] = [tuple(x) for x in post.get('faqs', [])]
    replace = mode == 'replace'
    P, W = check(post, replace=replace)
    for w in W:
        print(f'  WARN {w}')
    sim = post.get('_similarity')
    if sim and sim[1]:
        print(f'  closest existing post: /{sim[1]} (similarity {sim[0]})')
    if P:
        print('NOT PUBLISHED. Fix every problem below and run again:')
        for p in P:
            print(f'  - {p}')
        sys.exit(1)
    if mode == 'check':
        print('PASSED all checks (nothing written)')
        return
    now = datetime.now().replace(microsecond=0).isoformat()
    reg = load_json(REGISTRY, {'posts': {}})
    entry = reg['posts'].get(post['slug'], {})
    published = entry.get('published') or now
    if replace and not entry.get('published'):
        old = post_path(post['slug']).read_text(encoding='utf-8', errors='ignore')
        m = re.search(r'"datePublished":\s*"([^"]+)"', old)
        published = (m.group(1) + ('T09:00:00' if len(m.group(1)) == 10 else '')) if m else now
    page, words = render(post, published, now)
    out = post_path(post['slug'])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding='utf-8')
    update_index(post, replace)
    update_sitemap(post)
    reg['posts'][post['slug']] = {'title': post['title'], 'category': post['category'], 'published': published,
                                  'modified': now, 'words': words, 'primary_keyword': post['primary_keyword'],
                                  'source': 'claude-written' if not replace else 'claude-refreshed'}
    if replace:
        reg.setdefault('legacy_refreshed', [])
        if post['slug'] not in reg['legacy_refreshed']:
            reg['legacy_refreshed'].append(post['slug'])
    REGISTRY.write_text(json.dumps(reg, indent=2), encoding='utf-8')
    write_llms()
    print(f"{'REPLACED' if replace else 'PUBLISHED'} {post_url(post['slug'])} ({words} words)")


def status():
    reg = load_json(REGISTRY, {'posts': {}})
    posts = existing_posts()
    legacy = [s for s in sorted(posts) if s not in reg['posts']]
    q = load_json(PUB / 'queue.json', {'topics': []})['topics']
    todo = [x for x in q if x['slug'] not in posts]
    print(f'{len(posts)} posts on the site; {len(reg["posts"])} written through the publisher')
    print(f'{len(legacy)} legacy posts not yet refreshed: {", ".join(legacy[:8])}{" ..." if len(legacy) > 8 else ""}')
    print(f'{len(todo)} queued topics left. Next: ' + '; '.join(f"{x['slug']} ({x.get('note', '')})" for x in todo[:3]))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    if cmd in ('check', 'publish', 'replace'):
        if len(sys.argv) < 3:
            sys.exit('post.json path required')
        run(cmd, sys.argv[2])
    elif cmd == 'status':
        status()
    elif cmd == 'llms':
        print(f'llms.txt written ({write_llms()} lines)')
    else:
        sys.exit(__doc__)
