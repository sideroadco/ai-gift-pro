import { useState, useEffect, useRef, useCallback } from 'react';
import { GiftForm } from './components/GiftForm';
import { GiftCard } from './components/GiftCard';
import { RecipientInfo, GiftOption, GiftRecommendationResponse } from './types';
import { getGiftRecommendations } from './lib/gemini';
import { getAmazonUrl } from './lib/amazonUtils';

import logoMark from './assets/brand/logo-mark.png';
import heroBanner from './assets/brand/hero-banner.jpg';
import icPerson from './assets/brand/ic-person.png';
import icWand from './assets/brand/ic-wand.png';
import icBag from './assets/brand/ic-bag.png';
import icHeart from './assets/brand/ic-heart.png';
import icBudget from './assets/brand/ic-budget.png';
import icSparkle from './assets/brand/ic-sparkle.png';
import icOrb from './assets/brand/ic-orb.png';

/* Ai Gift Pro's own Amazon Associates tracking ID. Overridable per-deployment
   via VITE_AMAZON_AFFILIATE_TAG so a fork never silently earns for someone else. */
const DEFAULT_TAG = 'gifts0b9-20';
const TAG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-\d{2}$/i;

function resolveTag(): string {
  const fromEnv = (process.env.VITE_AMAZON_AFFILIATE_TAG || '').trim();
  if (fromEnv && TAG_RE.test(fromEnv)) return fromEnv;
  if (fromEnv) {
    console.warn(`[ai-gift-pro] VITE_AMAZON_AFFILIATE_TAG "${fromEnv}" is not a valid Associates tag; using ${DEFAULT_TAG}.`);
  } else {
    console.warn(`[ai-gift-pro] VITE_AMAZON_AFFILIATE_TAG is not set; using the built-in default ${DEFAULT_TAG}.`);
  }
  return DEFAULT_TAG;
}

const LOADING_MESSAGES = [
  'Reading the profile…',
  'Ruling out the obvious…',
  'Checking that these are real products…',
  'Finding the links…',
  'Writing up why each one fits…',
];

const PROOF = [
  'Real products, not invented ones',
  'Current prices',
  'No sign-up, ever',
  '12–15 ideas in under a minute',
  'Reader-supported',
  'Saved to your browser, not our servers',
];

/* Shown before the first search: an empty state should teach, not sit blank.
   These are real products and the links are real search links. */
const SAMPLE_GIFTS: GiftOption[] = [
  { name: 'Fellow Stagg EKG Electric Kettle',
    description: "A pour-over kettle that became a design object. Precise temperature dial, counterbalanced spout, good enough to leave on the counter.",
    priceRange: '$165', whyItsPerfect: 'It upgrades the exact thing she already does every single morning.',
    searchQuery: 'Fellow Stagg EKG electric kettle', asin: 'SEARCH', category: 'For the ritual' },
  { name: 'Leuchtturm1917 Reading Journal',
    description: 'A guided journal for tracking books — quotes, ratings, a running wishlist. Cloth-bound, the kind of thing a list-keeper loves.',
    priceRange: '$24', whyItsPerfect: 'Sentimental and useful at once, and it suits someone who haunts secondhand bookshops.',
    searchQuery: 'Leuchtturm1917 reading journal', asin: 'SEARCH', category: 'For the reader' },
  { name: 'Hasami Porcelain Mug & Tray',
    description: 'Japanese matte-glaze porcelain that stacks neatly. Quietly beautiful, dishwasher-safe, built to live in a cabinet without rattling.',
    priceRange: '$42', whyItsPerfect: 'Minimalist, stackable, made for a first apartment where every inch counts.',
    searchQuery: 'Hasami Porcelain mug tray', asin: 'SEARCH', category: 'For small spaces' },
];

const FAQS: Array<[string, string]> = [
  ['Is Ai Gift Pro free?',
   "Yes. No account, no paywall, no upsell. We keep the lights on through affiliate commissions — if you buy something through a link here, the retailer pays us a small cut at no extra cost to you."],
  ['How do the links work?',
   "Each buy button is an Amazon affiliate link. Click it and Amazon knows you came from us. If you buy within their window, they pay us a percentage. You pay exactly what you'd pay going to Amazon directly."],
  ['Do you store what I type?',
   "No. What you write goes to the model that writes your list, and that's it — nothing lands in a database of ours. Gifts you save are kept in your own browser, not on our servers."],
  ['Why only twelve to fifteen ideas?',
   "Because you'll read twelve. Fifty is a search results page with extra steps, and you already know how to use one of those."],
  ['What if none of them fit?',
   'Add a constraint and run it again. "Hates clutter." "Already has an espresso machine." "Nothing with a screen." A single specific limit sharpens the list far more than another adjective.'],
];

export default function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<GiftRecommendationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const [affiliateTag, setAffiliateTag] = useState(resolveTag);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [lastInfo, setLastInfo] = useState<RecipientInfo | null>(null);

  const [favorites, setFavorites] = useState<GiftOption[]>(() => {
    try {
      const raw = localStorage.getItem('gift-favorites');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const resultsRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  /* ---------- persistence ---------- */
  useEffect(() => {
    try {
      localStorage.setItem('gift-favorites', JSON.stringify(favorites));
    } catch { /* private mode — favourites just won't persist */ }
  }, [favorites]);

  /* ---------- runtime config (affiliate tag only; never a key) ---------- */
  useEffect(() => {
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const t = (data?.VITE_AMAZON_AFFILIATE_TAG || '').trim();
        if (t && TAG_RE.test(t)) setAffiliateTag(t);
      })
      .catch(() => { /* static host without the function — the build-time tag stands */ });
  }, []);

  /* ---------- nav shadow ---------- */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ---------- rotating loading copy ---------- */
  useEffect(() => {
    if (!isLoading) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      setLoadingMessage(LOADING_MESSAGES[i]);
    }, 2200);
    return () => clearInterval(id);
  }, [isLoading]);

  /* ---------- scroll reveals ---------- */
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    if (reduce) {
      nodes.forEach((n) => n.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      }),
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [results, favorites.length]);

  /* ---------- hero: pointer depth + scroll continuity ---------- */
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stage = stageRef.current, tilt = tiltRef.current;
    const glow = glowRef.current, hero = heroRef.current;
    if (reduce || !stage || !tilt || !glow || !hero) return;

    let tx = 0, ty = 0, cx = 0, cy = 0, raf: number | null = null;
    const apply = () => {
      cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
      tilt.style.setProperty('--ry', `${(cx * 4.5).toFixed(2)}deg`);
      tilt.style.setProperty('--rx', `${(-cy * 3.2).toFixed(2)}deg`);
      glow.style.setProperty('--gx', `${(-cx * 26).toFixed(1)}px`);
      glow.style.setProperty('--gy', `${(-cy * 18).toFixed(1)}px`);
      raf = (Math.abs(tx - cx) > 0.0008 || Math.abs(ty - cy) > 0.0008)
        ? requestAnimationFrame(apply) : null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse') return; // no tilt on touch
      const r = stage.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      tx = px - 0.5; ty = py - 0.5;
      tilt.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
      tilt.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
      tilt.classList.add('lit');
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      tx = 0; ty = 0; tilt.classList.remove('lit');
      if (!raf) raf = requestAnimationFrame(apply);
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const r = hero.getBoundingClientRect();
        const p = Math.min(Math.max(-r.top / (r.height * 0.8), 0), 1);
        stage.style.setProperty('--py', `${(p * 38).toFixed(1)}px`);
        stage.style.setProperty('--ps', `${(1 - p * 0.018).toFixed(4)}`);
        stage.style.setProperty('--po', `${(1 - p * 0.35).toFixed(3)}`);
        ticking = false;
      });
    };

    stage.addEventListener('pointermove', onMove, { passive: true });
    stage.addEventListener('pointerleave', onLeave, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /* ---------- the real flow ---------- */
  const runSearch = useCallback(async (info: RecipientInfo) => {
    setIsLoading(true);
    setError(null);
    setLoadingMessage(LOADING_MESSAGES[0]);
    setLastInfo(info);
    try {
      const data = await getGiftRecommendations(info);
      setResults(data);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (e: any) {
      setError(e?.message || "We couldn't put a list together just now. Give it another try.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const toggleFavorite = (gift: GiftOption) => {
    setFavorites((prev) =>
      prev.some((f) => f.name === gift.name)
        ? prev.filter((f) => f.name !== gift.name)
        : [...prev, gift],
    );
  };
  const isFav = (g: GiftOption) => favorites.some((f) => f.name === g.name);

  const proofLoop = [...PROOF, ...PROOF];

  return (
    <div id="top">
      <a className="skip" href="#start">Skip to content</a>

      {/* FTC / Amazon disclosure — above the fold, not buried */}
      <div className="disclosure">
        <div className="wrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
          <span><b>Reader-supported.</b> We earn a commission on some links — it never costs you a cent more.</span>
        </div>
      </div>

      <header className={scrolled ? 'nav scrolled' : 'nav'}>
        <div className="wrap">
          <a className="lockup" href="#top">
            <img className="mark" src={logoMark} alt="" />
            <span className="wm">Ai Gift <b>Pro</b></span>
          </a>
          <nav className="navlinks" aria-label="Primary">
            <a href="#start">Find a gift</a>
            {!results && <a href="#example">Sample list</a>}
            {favorites.length > 0 && <a href="#saved">Saved ({favorites.length})</a>}
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </nav>
          <a className="btn btn-primary" href="#start">Find my gift</a>
        </div>
      </header>

      <main>
        {/* ---------------- HERO ---------------- */}
        <section className="hero" ref={heroRef}>
          <div className="hero-bg" aria-hidden="true">
            <span className="blob b1" /><span className="blob b2" />
          </div>
          <div className="wrap">
            <span className="eyebrow r" style={{ ['--d' as any]: '.05s' }}>Thoughtful gifts, zero guesswork</span>
            <h1 className="r" style={{ ['--d' as any]: '.12s' }}>
              Find the gift they'll <span className="grad-text">actually love</span>.
            </h1>
            <p className="lede r" style={{ ['--d' as any]: '.20s' }}>
              Tell us who it's for, what they're into, and what you want to spend. You'll get a short list of real
              products — each with a reason it fits, and a link to buy it.
            </p>
            <div className="hero-cta r" style={{ ['--d' as any]: '.28s' }}>
              <a className="btn btn-primary" href="#start">
                Find my gift
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="m12 2 2.4 6.3L21 11l-6.6 1.7L12 19l-2.4-6.3L3 11l6.6-1.7z" />
                </svg>
              </a>
              <a className="btn btn-onDark" href="#how">See how it works</a>
            </div>
            <span className="note r" style={{ ['--d' as any]: '.36s' }}>
              <b>Free.</b> No account. About 30 seconds.
            </span>

            <div className="hero-stage" ref={stageRef}>
              <div className="hero-ring" aria-hidden="true" />
              <div className="hero-glow" ref={glowRef} aria-hidden="true" />
              <div className="hero-art">
                <div className="hero-tilt" ref={tiltRef}>
                  <img
                    src={heroBanner}
                    width={1672}
                    height={941}
                    alt="A glass gift box surrounded by floating gift ideas — headphones, a candle, a watch and a handbag"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- PROOF ---------------- */}
        <div className="proof">
          <ul className="sr">{PROOF.map((p) => <li key={p}>{p}</li>)}</ul>
          <div className="proof-track" aria-hidden="true">
            {proofLoop.map((p, i) => <span className="proof-item" key={i}>{p}</span>)}
          </div>
        </div>

        {/* ---------------- THE TOOL ---------------- */}
        <section className="sec" id="start">
          <div className="wrap">
            <div className="sec-head center reveal">
              <span className="eyebrow">The intake</span>
              <h2>Tell us about them.</h2>
              <p>The more specific you get, the better the list. "Likes coffee" works. "Drinks pour-over, hates clutter" works a lot better.</p>
            </div>

            <GiftForm onSubmit={runSearch} isLoading={isLoading} />

            {error && (
              <div className="errbox" role="alert">
                <div className="et">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E5484D" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16h.01" />
                  </svg>
                  <h4>That didn't go through</h4>
                </div>
                <p>{error}</p>
                {lastInfo && (
                  <button className="btn-retry" type="button" onClick={() => runSearch(lastInfo)}>
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ---------------- SAMPLE (empty state) ---------------- */}
        {!results && !isLoading && (
          <section className="sec sec-alt" id="example">
            <div className="wrap">
              <div className="sec-head reveal" style={{ marginBottom: 30 }}>
                <span className="eyebrow">What you get</span>
                <h2>A short list, with reasons.</h2>
                <p>Here's an example for a 32-year-old who lives on pour-over coffee and secondhand books, and just moved somewhere small.</p>
              </div>

              <div className="disc-band reveal">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span>Buy buttons go to Amazon. If you buy, we may earn a commission — your price stays the same.</span>
              </div>

              <div className="grid">
                {SAMPLE_GIFTS.map((gift, i) => (
                  <GiftCard
                    key={gift.name}
                    gift={gift}
                    index={i}
                    tag={affiliateTag}
                    isFavorite={isFav(gift)}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </div>

              <p className="res-foot">
                An example list. Prices are estimates from the model, not live Amazon prices.
              </p>
            </div>
          </section>
        )}

        {/* ---------------- RESULTS ---------------- */}
        {results && (
          <section className="sec sec-alt" ref={resultsRef} id="results">
            <div className="wrap">
              <div className="sec-head reveal" style={{ marginBottom: 30 }}>
                <span className="eyebrow">The edit</span>
                <h2>Chosen for them.</h2>
                {results.summary && <p>{results.summary}</p>}
              </div>

              <div className="disc-band reveal">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span>Buy buttons go to Amazon. If you buy, we may earn a commission — your price stays the same.</span>
              </div>

              <div className="grid" aria-live="polite">
                {results.recommendations.map((gift, i) => (
                  <GiftCard
                    key={`${gift.name}-${i}`}
                    gift={gift}
                    index={i}
                    tag={affiliateTag}
                    isFavorite={isFav(gift)}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </div>

              <p className="res-foot">
                Prices are estimates from the model, not live Amazon prices. Amazon has the final word.
              </p>
            </div>
          </section>
        )}

        {/* ---------------- SAVED ---------------- */}
        {favorites.length > 0 && (
          <section className="faves" id="saved">
            <div className="wrap">
              <div className="faves-head">
                <div>
                  <span className="eyebrow">Saved</span>
                  <h2 style={{ fontSize: 'clamp(1.8rem,3.4vw,2.6rem)', marginTop: 14 }}>
                    Your shortlist.
                  </h2>
                </div>
                <button className="clearall" type="button" onClick={() => setFavorites([])}>
                  Clear all
                </button>
              </div>
              <div className="grid">
                {favorites.map((gift) => (
                  <div className="fave-card" key={gift.name}>
                    <span className="fc-cat">{gift.category}</span>
                    <h3>{gift.name}</h3>
                    <p className="fc-desc">{gift.description}</p>
                    <a className="btn-amz-d" href={getAmazonUrl(gift, affiliateTag)} target="_blank" rel="sponsored noopener noreferrer">
                      View on Amazon
                    </a>
                    <span className="gsmall" style={{ marginTop: 8 }}>Affiliate link — we may earn a commission</span>
                    <button className="fave-remove" type="button" onClick={() => toggleFavorite(gift)}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ---------------- HOW IT WORKS ---------------- */}
        <section className="sec" id="how">
          <div className="wrap">
            <div className="sec-head reveal">
              <span className="eyebrow">How it works</span>
              <h2>Three questions in, a real list out.</h2>
            </div>
            <div className="steps">
              <article className="step reveal">
                <img src={icPerson} alt="" />
                <div className="num">01</div>
                <h3>Describe the person</h3>
                <p>Their age and the occasion, sure — but also what they're into and the kind of person they are. The more honest, the better the match.</p>
              </article>
              <article className="step reveal">
                <img src={icWand} alt="" />
                <div className="num">02</div>
                <h3>We match, not guess</h3>
                <p>The model reads the whole profile and pulls real, current products that fit — skipping the obvious mug-and-socks defaults.</p>
              </article>
              <article className="step reveal">
                <img src={icBag} alt="" />
                <div className="num">03</div>
                <h3>Shop the shortlist</h3>
                <p>Every idea comes with why it fits and a direct link. Save the ones you like; come back when you're ready to buy.</p>
              </article>
            </div>
          </div>
        </section>

        {/* ---------------- HONESTY ---------------- */}
        <section className="sec sec-alt">
          <div className="wrap why-grid">
            <div className="reveal">
              <span className="eyebrow">Why trust us</span>
              <h2 style={{ fontSize: 'clamp(2rem,3.9vw,3rem)', marginTop: 16 }}>
                We make money on links. So we're honest about being one.
              </h2>
              <div className="whylist">
                <div className="whyitem">
                  <img src={icHeart} alt="" />
                  <div>
                    <h4>We say when we earn</h4>
                    <p>Every buy button is an affiliate link. We tell you at the top of the page, not in the footer's fine print — a tip you can't trust isn't worth much.</p>
                  </div>
                </div>
                <div className="whyitem">
                  <img src={icBudget} alt="" />
                  <div>
                    <h4>Real products, honest prices</h4>
                    <p>Every idea is something you can buy today. No invented items. Prices are estimates, and we say so rather than pretending they're live.</p>
                  </div>
                </div>
                <div className="whyitem">
                  <img src={icSparkle} alt="" />
                  <div>
                    <h4>Twelve good ideas, not fifty</h4>
                    <p>A short list you'll actually read beats an endless scroll you won't. Fewer, better choices — that's the whole product.</p>
                  </div>
                </div>
              </div>
            </div>
            <aside className="pov reveal">
              <h3>What we won't do</h3>
              <ul>
                {['Pad the list with filler you\u2019d never buy.',
                  'Hide that the links pay us.',
                  'Invent products that don\u2019t exist.',
                  'Ask you to make an account to see a list.',
                  'Keep what you typed about someone you love.'].map((line) => (
                  <li key={line}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section className="sec" id="faq">
          <div className="wrap">
            <div className="sec-head reveal">
              <span className="eyebrow">Questions</span>
              <h2>Good to know before you start.</h2>
            </div>
            <div className="faq-list reveal">
              {FAQS.map(([q, a], i) => (
                <div className={openFaq === i ? 'faq-item open' : 'faq-item'} key={q}>
                  <button
                    className="faq-q"
                    type="button"
                    aria-expanded={openFaq === i}
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    <h3>{q}</h3>
                    <span className="faq-ico" aria-hidden="true" />
                  </button>
                  <div className="faq-a"><p>{a}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <div className="foot-top">
            <div className="foot-brand">
              <a className="lockup" href="#top" style={{ marginBottom: 16 }}>
                <img className="mark" src={logoMark} alt="" />
                <span className="wm">Ai Gift <b>Pro</b></span>
              </a>
              <p>A faster way to find a gift that fits the person — not just the occasion.</p>
              <div className="foot-disc">
                <b>Affiliate disclosure:</b> Ai Gift Pro is a participant in the Amazon Associates Program.
                As an Amazon Associate I earn from qualifying purchases. Buying through our links costs you nothing extra.
              </div>
            </div>
            <div className="foot-cols">
              <div className="foot-col">
                <h4>Pages</h4>
                <a href="#start">Find a gift</a>
                <a href="#how">How it works</a>
                <a href="#faq">FAQ</a>
              </div>
              <div className="foot-col">
                <h4>More</h4>
                <a href="#">Privacy</a>
                <a href="#">Disclosure</a>
                <a href="#">Contact</a>
              </div>
            </div>
          </div>
          <div className="foot-bottom">
            <span>© {new Date().getFullYear()} Ai Gift Pro.</span>
            <span>Made for people who care about getting it right.</span>
          </div>
        </div>
      </footer>

      {isLoading && (
        <div className="overlay" role="status" aria-live="polite">
          <div className="loadcard">
            <div className="ring"><img src={icOrb} alt="" /></div>
            <h3>Finding your gifts…</h3>
            <p>{loadingMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}
