import { GiftOption } from '../types';
import { getAmazonUrl } from '../lib/amazonUtils';

interface Props {
  gift: GiftOption;
  index: number;
  tag: string;
  isFavorite: boolean;
  onToggleFavorite: (gift: GiftOption) => void;
}

/** Brand pastels — the same gradient family as the hero illustration's idea cards. */
const BANDS = [
  'linear-gradient(135deg,#8EDBFF,#B99BFF)',
  'linear-gradient(135deg,#B99BFF,#FFB6D9)',
  'linear-gradient(135deg,#A9D8FF,#C9B8FF)',
  'linear-gradient(135deg,#C9B8FF,#FFC2E0)',
  'linear-gradient(135deg,#9FD4FF,#B99BFF)',
];

/** "$40 - $60" -> "$40–$60"; keep it short so the pill never wraps. */
function tidyPrice(raw: string): string {
  const p = (raw || '').trim();
  if (!p) return '';
  return p.replace(/\s*-\s*/g, '–').replace(/\s+/g, ' ');
}

export function GiftCard({ gift, index, tag, isFavorite, onToggleFavorite }: Props) {
  const amazonUrl = getAmazonUrl(gift, tag);
  const price = tidyPrice(gift.priceRange);

  return (
    <article className="gcard">
      <div className="gvis" style={{ background: BANDS[index % BANDS.length] }}>
        <svg className="spark" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="m12 2 2.4 6.3L21 11l-6.6 1.7L12 19l-2.4-6.3L3 11l6.6-1.7z" />
        </svg>
        <button
          className="fav"
          type="button"
          aria-pressed={isFavorite}
          aria-label={isFavorite ? `Remove ${gift.name} from saved gifts` : `Save ${gift.name}`}
          onClick={() => onToggleFavorite(gift)}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 1.9 5 5.2 5c2 0 3.3 1.1 4.1 2.3C10.1 6.1 11.4 5 13.4 5c3.3 0 4.8 3.4 3.2 6.7C18.1 16.4 12 21 12 21z" />
          </svg>
        </button>
        <span className="gcat">{gift.category}</span>
        {price && (
          <span className="gprice">
            <em>≈</em> {price}
          </span>
        )}
      </div>

      <div className="gbody">
        <h3>{gift.name}</h3>
        <p className="gdesc">{gift.description}</p>
        {gift.whyItsPerfect && (
          <div className="gwhy">
            <span className="lbl">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                <path d="M5 13l4 4L19 7" />
              </svg>
              Why it fits
            </span>
            <p>{gift.whyItsPerfect}</p>
          </div>
        )}
      </div>

      <div className="gfoot">
        <a className="btn-buy" href={amazonUrl} target="_blank" rel="sponsored noopener noreferrer">
          View on Amazon
        </a>
        {/* Per-recommendation disclosure: the FTC wants this next to the link,
            not only in the page footer. */}
        <span className="gsmall">Affiliate link — we may earn a commission</span>
      </div>
    </article>
  );
}
