'use client';
import { keyLabel, useSettings } from '@/lib/settings';

/**
 * Picture guides for the weapon systems (no text-only tutorials): how to open the attachment
 * screen, and how to switch night vision in a night-vision scope.
 */
export function AttachGuide() {
  const { attachKey } = useSettings();
  const key = keyLabel(attachKey);
  return (
    <figure className="wg-guide" aria-label={`Cầm súng rồi nhấn ${key}, hoặc chuột phải vào súng trong túi đồ, để mở màn hình phụ kiện`}>
      <svg viewBox="0 0 320 96" role="img" aria-hidden>
        {/* Path 1: gun in hand + key */}
        <g transform="translate(8 10)">
          <rect className="wg-panel" width="148" height="76" rx="6" />
          <g className="wg-gun" transform="translate(14 30)">
            <path d="M0 6h46l6-6h18v8h-8l-2 6h-10l-4 12h-9l3-12H8l-4 8H0z" />
            <rect className="wg-hot" x="26" y="-7" width="14" height="6" rx="1.5" />
          </g>
          <path className="wg-arrow" d="M92 40h12 M100 36l4 4l-4 4" />
          <g transform="translate(126 40)">
            <rect className="wg-key" x={key.length > 1 ? -18 : -13} y="-13" width={key.length > 1 ? 36 : 26} height="26" rx="4" />
            <text y="5" textAnchor="middle">{key}</text>
          </g>
        </g>
        <text className="wg-or" x="160" y="53" textAnchor="middle">/</text>
        {/* Path 2: right-click the gun in the inventory grid */}
        <g transform="translate(164 10)">
          <rect className="wg-panel" width="148" height="76" rx="6" />
          {[0, 1, 2, 3, 4, 5].map((x) => [0, 1, 2].map((y) => <rect key={`${x}${y}`} className="wg-cell" x={10 + x * 15} y={10 + y * 15} width="13" height="13" />))}
          <rect className="wg-item" x="10" y="25" width="58" height="13" />
          <g className="wg-mouse" transform="translate(118 40)">
            <rect x="-13" y="-22" width="26" height="44" rx="13" />
            <path d="M0 -22V-5 M-13 -5H13" />
            <path className="wg-hot" d="M0 -22A13 13 0 0 1 13 -9V-5H0Z" />
          </g>
          <path className="wg-arrow" d="M100 33l-26 0 M78 29l-4 4l4 4" />
        </g>
      </svg>
    </figure>
  );
}

/** Aim (right mouse) → M or the mouse wheel → green night-vision picture. */
export function NightVisionGuide() {
  const { nvKey } = useSettings();
  return (
    <figure className="wg-guide" aria-label={`Chuột phải để ngắm, rồi nhấn ${keyLabel(nvKey)} hoặc lăn chuột để bật tắt nhìn đêm`}>
      <svg viewBox="0 0 220 70" role="img" aria-hidden>
        <g className="wg-mouse" transform="translate(22 35)"><rect x="-12" y="-20" width="24" height="40" rx="12" /><path d="M0 -20V-4 M-12 -4H12" /><path className="wg-hot" d="M0 -20V-4H12V-8A12 12 0 0 0 0 -20Z" /></g>
        <path className="wg-arrow" d="M44 35h16 M55 30l5 5l-5 5" />
        <g transform="translate(84 35)"><rect className="wg-key" x="-13" y="-13" width="26" height="26" rx="4" /><text y="6" textAnchor="middle">{keyLabel(nvKey)}</text></g>
        <text className="wg-or" x="106" y="40" textAnchor="middle">/</text>
        <g className="wg-mouse" transform="translate(126 35)"><rect x="-12" y="-20" width="24" height="40" rx="12" /><rect className="wg-hot wg-wheel" x="-2.5" y="-15" width="5" height="10" rx="2.5" /><path d="M17 -10l4 -5l4 5 M17 10l4 5l4 -5" /></g>
        <path className="wg-arrow" d="M156 35h16 M167 30l5 5l-5 5" />
        <g transform="translate(198 35)"><circle className="wg-lens" r="20" /><circle className="wg-lens-glow" r="20" /><path className="wg-ret" d="M-20 0H20 M0 -20V20" /><circle className="wg-ret-dot" r="1.6" /></g>
      </svg>
    </figure>
  );
}
