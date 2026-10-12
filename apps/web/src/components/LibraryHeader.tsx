import Link from 'next/link';
import { LibraryNav } from './LibraryNav';
import { Icon } from './Icon';

export function LibraryHeader({ active }: { active: 'handbook' | 'news' }) {
  return <header className="library-top"><Link className="library-home" href="/"><Icon name="lucide:arrow-left" /><b>ZI<span>O</span>N</b><small>Về sảnh chính</small></Link><LibraryNav active={active} /><span className="library-top-caption">THE LAST LIGHT</span></header>;
}
