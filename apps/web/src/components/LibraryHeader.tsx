import Link from 'next/link';
import { LibraryNav } from './LibraryNav';
import { Icon } from './Icon';

export function LibraryHeader({ active }: { active: 'handbook' | 'news' }) {
  return <header className="library-top"><Link className="library-home" href="/" aria-label="Về sảnh chính" title="Về sảnh chính"><Icon name="lucide:arrow-left" /><b>ZI<span>O</span>N</b></Link><LibraryNav active={active} /></header>;
}
