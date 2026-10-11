/** Circular optic, opaque outer housing and an etched reticle centred on the camera ray. */
export function ScopeOverlay({ magnification }: { magnification: number }) {
  return (
    <div className="fp-scope" aria-hidden>
      <div className="fp-scope-lens">
        <svg className="fp-scope-reticle" viewBox="-100 -100 200 200">
          <g className="fp-scope-etching">
            <path d="M-100 0H-3 M3 0H100 M0-100V-3 M0 3V100" />
            {[-60, -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60].map((offset) => {
              const tick = offset % 20 === 0 ? 3 : 1.7;
              return <path key={offset} d={`M${offset} ${-tick}v${tick * 2} M${-tick} ${offset}h${tick * 2}`} />;
            })}
          </g>
          <circle className="fp-scope-dot" r="0.65" />
          <text className="fp-scope-power" x="0" y="-73" textAnchor="middle">{magnification}×</text>
        </svg>
      </div>
    </div>
  );
}
