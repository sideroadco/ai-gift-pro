import React from 'react';
import { RecipientInfo } from '../types';
import icGiftbox from '../assets/brand/ic-giftbox.png';

interface Props {
  onSubmit: (info: RecipientInfo) => void;
  isLoading: boolean;
}

const RELATIONSHIPS = ['Partner', 'Parent', 'Friend', 'Sibling', 'Kid', 'Coworker'];
const OCCASIONS = ['Birthday', 'Anniversary', 'Holiday', 'Thank you', 'Housewarming', 'Just because'];
const BUDGETS = ['Under $25', '$25–50', '$50–100', '$100–250', '$250+'];

export function GiftForm({ onSubmit, isLoading }: Props) {
  const [relationship, setRelationship] = React.useState('');
  const [occasion, setOccasion] = React.useState('');
  const [budget, setBudget] = React.useState('');
  const [age, setAge] = React.useState('');
  const [personality, setPersonality] = React.useState('');
  const [interests, setInterests] = React.useState('');

  const hasInterests = interests.trim().length >= 8;
  const isValid = hasInterests && !!relationship;

  // A disabled button should always say WHY it's disabled.
  const reason = !relationship
    ? "Pick who it's for to continue."
    : !hasInterests
      ? "Add a few words about what they're into to continue."
      : '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || isLoading) return;
    onSubmit({
      relationship,
      occasion,
      budget,
      age,
      personality,
      interests,
      gender: '', // not collected; the model does better without a guess
    });
  };

  const Chips = ({
    label, id, options, value, onChange,
  }: { label: string; id: string; options: string[]; value: string; onChange: (v: string) => void }) => (
    <div className="fgroup">
      <span className="flabel" id={id}>{label}</span>
      <div className="chips" role="group" aria-labelledby={id}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className="chip"
            aria-pressed={value === opt}
            onClick={() => onChange(value === opt ? '' : opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <form className="formcard reveal" onSubmit={submit} noValidate>
      <div className="formcard-top">
        <img src={icGiftbox} alt="" />
        <div>
          <h3>Who are we shopping for?</h3>
          <p>Four quick questions. Nothing is saved.</p>
        </div>
      </div>

      <div className="fbody">
        <Chips label="Your relationship" id="lbl-rel" options={RELATIONSHIPS} value={relationship} onChange={setRelationship} />
        <Chips label="The occasion" id="lbl-occ" options={OCCASIONS} value={occasion} onChange={setOccasion} />
        <Chips label="Budget" id="lbl-bud" options={BUDGETS} value={budget} onChange={setBudget} />

        <div className="fgroup">
          <div className="frow">
            <div>
              <label className="flabel" htmlFor="age">Roughly how old</label>
              <input
                className="inp" id="age" type="text" autoComplete="off"
                placeholder="32, or “late twenties”"
                value={age} onChange={(e) => setAge(e.target.value)}
              />
            </div>
            <div>
              <label className="flabel" htmlFor="vibe">What kind of person</label>
              <input
                className="inp" id="vibe" type="text" autoComplete="off"
                placeholder="Practical, sentimental, hard to buy for…"
                value={personality} onChange={(e) => setPersonality(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="fgroup">
          <label className="flabel" htmlFor="interests">What are they into?</label>
          <textarea
            id="interests"
            placeholder="Pour-over coffee, secondhand bookshops, just moved into a tiny apartment. Hates clutter."
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
          />
          <p className="fhelp">Habits and quirks beat adjectives. Tell us what they already do on a Saturday.</p>
        </div>

        <div className="fsubmit">
          <button className="btn-find" type="submit" disabled={!isValid || isLoading}>
            {isLoading ? (
              <>
                <span className="btn-spin" aria-hidden="true" />
                Finding your gifts…
              </>
            ) : (
              <>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="m12 2 2.4 6.3L21 11l-6.6 1.7L12 19l-2.4-6.3L3 11l6.6-1.7z" />
                </svg>
                Find my gift
              </>
            )}
          </button>
          <p className={reason ? 'fnote reason' : 'fnote'}>
            {reason || 'Free · No account · About 30 seconds'}
          </p>
        </div>
      </div>
    </form>
  );
}
