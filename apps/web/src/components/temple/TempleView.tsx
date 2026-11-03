'use client';

import { useEffect, useRef } from 'react';
import { TempleScene, type TempleGraphics } from '@/game/temple/scene';
import { templeStream } from '@/lib/temple-api';
import './temple.css';

/**
 * The Chánh Điện scene in a box: mounts a TempleScene and feeds it the server's event stream.
 * `graphics` (studio preview) overrides what the stream says while the admin is editing.
 */
export function TempleView({ graphics, className }: { graphics?: TempleGraphics | null; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TempleScene | null>(null);
  const override = useRef(graphics);
  override.current = graphics;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const s = new TempleScene(el); scene.current = s;
    const stop = templeStream((m) => {
      if (m.type === 'event') s.receive(m.event);
      else if (m.type === 'status') s.setStatus(m.status);
      else if (!override.current) s.applyGraphics(m.graphics);
    });
    return () => { stop(); s.dispose(); scene.current = null; };
  }, []);

  useEffect(() => { if (graphics) scene.current?.applyGraphics(graphics); }, [graphics]);

  return <div ref={host} className={`tp-host ${className ?? ''}`} />;
}
