const prefixes = ['Tân Binh', 'Lữ Khách', 'Chiến Binh', 'Người Sống Sót'];
export function randomGuestName(): string {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return `${prefixes[values[0]! % prefixes.length]} ${String(values[1]! % 100000).padStart(5, '0')}`;
}
