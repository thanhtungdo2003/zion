import { describe, expect, it } from 'vitest';
import { ITEMS } from '@zion/shared';
import { isTKey, itemDescription, itemName, serverMessage, translateMsg } from './i18n';

describe('catalog localization', () => {
  it.each(Object.keys(ITEMS))('has a translated name and description for %s', id => {
    expect(isTKey(`item.${id}`)).toBe(true);
    expect(itemName('vi', id)).not.toBe(id);
    expect(itemDescription('vi', id)).not.toBe('');
    expect(itemDescription('vi', id)).not.toMatch(/\{\w+\}/);
  });

  it('uses Vietnamese names in interaction prompts', () => {
    expect(translateMsg('vi', { key: 'interact.pickup', vars: { item: 'potato' } })).toBe('Nhặt Khoai tây');
  });

  it('translates generated armour descriptions', () => {
    expect(itemDescription('vi', 'combat_helmet')).toContain('giảm');
    expect(itemDescription('vi', 'combat_helmet')).not.toMatch(/damage|common|rare/);
  });
});

describe('server messages', () => {
  it('localizes raw game errors', () => {
    expect(translateMsg('vi', { key: 'raw', vars: { text: 'Inventory full' } })).toBe('Túi đồ đã đầy');
  });
  it('localizes authentication errors by stable protocol code', () => {
    expect(serverMessage('vi', 'invalid username or password', 'invalid_credentials')).toBe('Tên đăng nhập hoặc mật khẩu không đúng.');
  });
  it('preserves specific Vietnamese server instructions and player names', () => {
    expect(serverMessage('vi', 'Đội cần ít nhất 2 thành viên.', 'invalid_request')).toBe('Đội cần ít nhất 2 thành viên.');
    expect(translateMsg('vi', { key: 'interact.talk', vars: { item: 'Bác Ba' } })).toBe('Nói chuyện với Bác Ba');
  });
});
