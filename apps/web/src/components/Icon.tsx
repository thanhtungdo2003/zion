import { Icon as Iconify } from '@iconify/react';
import game from '@iconify-json/game-icons/icons.json';
import lucide from '@iconify-json/lucide/icons.json';

/** Bundled icon data: works offline without requests to the Iconify API. */
export function Icon({ name, className }: { name: string; className?: string }) {
  const [set, key] = name.split(':');
  const data = (set === 'game-icons' ? game : lucide).icons;
  const icon = data[key as keyof typeof data];
  return icon ? <Iconify icon={{ ...icon, width: set === 'game-icons' ? 512 : 24, height: set === 'game-icons' ? 512 : 24 }} className={className} aria-hidden="true" /> : null;
}
