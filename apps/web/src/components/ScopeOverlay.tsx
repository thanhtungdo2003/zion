'use client';
import { useEffect, useState } from 'react';
import { scopeFov } from '@/game/scope';

/** First-person base field of view (degrees), as in the engine. */
const FP_FOV = 75;

type Reticle = 'duplex' | 'mildot' | 'dot' | 'holo' | 'rocket';

/** Screen size, to calibrate the reticle against the real angular view. */
function useViewport(): { w: number; h: number } {
  const [size, setSize] = useState(() => (typeof window === 'undefined' ? { w: 1280, h: 720 } : { w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

/**
 * Magnified optic: circular sight picture with an opaque housing, and a reticle drawn (not baked
 * into a texture) on the camera ray. Marks are spread over the lens like a real second-focal-plane
 * reticle: ten divisions from the centre to the edge, whatever the magnification (a true 1 mrad
 * spacing at game FOVs would bunch every mark into a few pixels around the dot).
 */
export function ScopeOverlay({ magnification, reticle = 'duplex', nightVision = false, nvScope = false }: { magnification: number; reticle?: Reticle | null; nightVision?: boolean; nvScope?: boolean }) {
  const { w, h } = useViewport();
  // The night-vision picture guide shows for ~3 s each time the scope comes up, then fades out.
  const [hint, setHint] = useState(true);
  useEffect(() => {
    if (!nvScope) return;
    setHint(true);
    const t = window.setTimeout(() => setHint(false), 3000);
    return () => window.clearTimeout(t);
  }, [nvScope]);
  // Lens diameter in pixels (CSS: min(84vmin, 960px) minus the 8 px border on each side).
  // One division in reticle units (viewBox −100…100 across the lens); thin lines stay ≥ 1 px.
  const lens = Math.min(Math.min(w, h) * .84, 960) - 16;
  void scopeFov; void FP_FOV;
  const mil = 9;
  const marks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((m) => m * mil < 92);
  const px = 200 / Math.max(1, lens);
  return (
    <div className="fp-scope" aria-hidden>
      <div className={`fp-scope-lens${nightVision ? ' nv' : ''}`}>
        <svg className="fp-scope-reticle" viewBox="-100 -100 200 200">
          <g className="fp-scope-etching">
            {reticle === 'rocket' ? <RocketReticle px={px} /> : reticle === 'mildot' ? <>
              <path d="M-100 0H-1.2 M1.2 0H100 M0-100V-1.2 M0 1.2V100" />
              {marks.map((m) => <g key={m}>
                {[[m, 0], [-m, 0], [0, m], [0, -m]].map(([x, y], i) => <circle key={i} className="fp-scope-mil" cx={x! * mil} cy={y! * mil} r={px * 1.6} />)}
              </g>)}
              {/* Holdover ladder below the centre, every half mil, labelled each whole mil. */}
              {marks.slice(0, 5).map((m) => <g key={`h${m}`}>
                <path d={`M${-mil * .35} ${m * mil}h${mil * .7}`} />
                <text className="fp-scope-label" x={mil * .55} y={m * mil + 1.6}>{m}</text>
              </g>)}
            </> : <>
              {/* Duplex: heavy outer posts thinning to fine crosshairs ±4 mil from the centre. */}
              <path className="fp-scope-post" d={`M-100 0H${-4 * mil} M${4 * mil} 0H100 M0 ${4 * mil}V100`} />
              <path d={`M${-4 * mil} 0H-1.4 M1.4 0H${4 * mil} M0 ${-100}V-1.4 M0 1.4V${4 * mil}`} />
              {[1, 2, 3].map((m) => <path key={m} d={`M${-mil * .3} ${m * mil}h${mil * .6}`} />)}
            </>}
          </g>
          {/* A fine aiming point where the wires meet (about two pixels). */}
          {reticle !== 'rocket' && <circle className="fp-scope-dot" r={px * 1.1} />}
          <text className="fp-scope-power" x="0" y="-73" textAnchor="middle">{magnification}×{nvScope ? (nightVision ? ' · NV' : ' · NGÀY') : ''}</text>
          {nvScope && hint && <NightVisionHint on={nightVision} />}
        </svg>
      </div>
    </div>
  );
}

/**
 * Rocket launcher sight (PGO-7 style): a chevron aiming mark, a range ladder below it (2–5 for
 * 200–500 m) with lead ticks for crossing targets, and the stadia curve for a 2.7 m tall target.
 */
function RocketReticle({ px }: { px: number }) {
  const step = 12, lead = [-3, -2, -1, 1, 2, 3];
  return <g className="fp-scope-rocket">
    <path className="fp-scope-chevron" d="M-6 6L0 0L6 6" />
    <path d={`M-90 0H-14 M14 0H90`} />
    {lead.map((k) => <path key={k} d={`M${k * step} -4V4`} />)}
    {[2, 3, 4, 5].map((r, i) => {
      const y = (i + 1) * step, half = 9 - i * 1.4;
      return <g key={r}>
        <path className="fp-scope-chevron" d={`M${-half * .5} ${y + half * .45}L0 ${y}L${half * .5} ${y + half * .45}`} />
        <path d={`M${-half - 6} ${y}H${-half - 1} M${half + 1} ${y}H${half + 6}`} />
        <text className="fp-scope-label" x={-half - 10} y={y + 1.8} textAnchor="end">{r}</text>
      </g>;
    })}
    {/* Rangefinder: a target 2.7 m tall fills the gap between the base line and the curve. */}
    <path className="fp-scope-stadia" d={`M30 ${-step * .2}C44 ${-step * 1.8} 60 ${-step * 2.6} 78 ${-step * 3}`} />
    <path d={`M30 0H78`} strokeWidth={Math.max(px, .6)} />
    {[2, 4, 6, 8, 10].map((r, i) => <text key={r} className="fp-scope-label small" x={34 + i * 10.5} y={6}>{r}</text>)}
  </g>;
}

/** Picture-only hint inside the lens: the M key or the mouse wheel switches night vision. */
function NightVisionHint({ on }: { on: boolean }) {
  return (
    <g className={`fp-nv-hint${on ? ' on' : ''}`} transform="translate(0 70)">
      {/* M key */}
      <g transform="translate(-34 0)">
        <rect x="-7" y="-7" width="14" height="14" rx="2.5" />
        <text y="3.4" textAnchor="middle">M</text>
      </g>
      <text className="fp-nv-or" x="-20" y="2.4" textAnchor="middle">/</text>
      {/* Mouse with the wheel highlighted and up/down arrows */}
      <g transform="translate(-6 0)">
        <rect x="-6" y="-9" width="12" height="18" rx="6" />
        <rect className="fp-nv-wheel" x="-1.2" y="-6" width="2.4" height="5" rx="1.2" />
        <path d="M9 -5l2.5 -3l2.5 3 M9 5l2.5 3l2.5 -3" />
      </g>
      {/* → eye in night vision */}
      <path d="M17 0h6 M21 -2l2 2l-2 2" />
      <g transform="translate(36 0)">
        <path className="fp-nv-eye" d="M-9 0q9 -9 18 0q-9 9 -18 0z" />
        <circle className="fp-nv-pupil" r="3" />
      </g>
    </g>
  );
}

/** Red dot sight: the dot is drawn on the aiming ray, seen through the optic's window. */
export function RedDotReticle({ holo = false }: { holo?: boolean }) {
  return <div className={`fp-reddot${holo ? ' holo' : ''}`} aria-hidden><i />{holo && <b />}</div>;
}
