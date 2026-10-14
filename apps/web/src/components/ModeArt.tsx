/** Small illustrations for the game-mode picker, drawn in the HUD palette (amber accent, red zone). */
export function ModeArt({ mode }: { mode: 'survival' | 'battle-royale' }) {
  if (mode === 'battle-royale') return (
    <svg className="mode-art" viewBox="0 0 120 72" aria-hidden focusable="false">
      <rect width="120" height="72" fill="#14100f" />
      <path d="M0 58 Q30 48 56 54 T120 50 V72 H0Z" fill="#2a1d18" />
      {/* the closing red zone and the next safe circle */}
      <circle cx="70" cy="56" r="40" fill="none" stroke="#ff263d" strokeWidth="2" opacity=".9" />
      <circle cx="74" cy="58" r="20" fill="none" stroke="#fff" strokeWidth="1.2" strokeDasharray="4 3" opacity=".8" />
      {/* transport plane */}
      <path d="M14 14 L46 10 L48 13 L16 18Z" fill="#9aa3a8" />
      <path d="M28 12 L34 3 L38 3 L34 12Z M30 16 L36 24 L40 24 L35 15Z" fill="#7d868b" />
      {/* parachutist */}
      <path d="M78 18 Q88 6 98 18Z" fill="#db293e" />
      <path d="M80 18 L88 30 M96 18 L88 30" stroke="#d5d0ba" strokeWidth=".8" />
      <rect x="86.5" y="29" width="3" height="5" fill="#ffb000" />
    </svg>
  );
  return (
    <svg className="mode-art" viewBox="0 0 120 72" aria-hidden focusable="false">
      <rect width="120" height="72" fill="#0f1312" />
      <circle cx="96" cy="16" r="7" fill="#d9d2b5" opacity=".7" />
      <path d="M0 56 Q40 46 70 52 T120 48 V72 H0Z" fill="#1b2420" />
      {/* pines */}
      <path d="M8 56 L16 30 L24 56Z M20 56 L27 36 L34 56Z M98 52 L106 28 L114 52Z" fill="#21302a" />
      {/* camp tent and fire */}
      <path d="M44 58 L58 40 L72 58Z" fill="#3b3a2c" />
      <path d="M58 40 L58 58" stroke="#0f1312" strokeWidth="1.5" />
      <path d="M80 58 Q83 50 86 58Z" fill="#ffb000" />
      <path d="M82 58 Q83 54 85 58Z" fill="#ffe08a" />
      {/* a zombie at the treeline */}
      <path d="M33 58 V48 M33 50 L39 47 M33 50 L38 52 M33 58 L31 62 M33 58 L35 62" stroke="#6f8f5a" strokeWidth="2" strokeLinecap="round" />
      <circle cx="33" cy="45.5" r="2.4" fill="#6f8f5a" />
    </svg>
  );
}
