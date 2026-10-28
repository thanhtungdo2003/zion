'use client';

import dynamic from 'next/dynamic';

// WebGL editor: client only.
const ModelStudio = dynamic(() => import('@/components/model-studio/ModelStudio'), { ssr: false, loading: () => <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)' }} /> });

export default function ModelStudioPage() {
  return <ModelStudio />;
}
