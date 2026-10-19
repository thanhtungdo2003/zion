import { describe, expect, it } from 'vitest';
import { WorldChat } from './world-chat';

describe('world chat', () => {
  it('keeps recent lines, hands out only newer ones and slows down a spammer', () => {
    const chat = new WorldChat();
    expect(chat.post('a', 'An', 'xin chào', 0)).toMatchObject({ id: 1, name: 'An', text: 'xin chào' });
    expect(chat.post('a', 'An', 'lại nữa', 1000)).toBeNull();
    expect(chat.post('b', 'Bình', 'chào', 1000)).toMatchObject({ id: 2 });
    expect(chat.since(1).map((l) => l.text)).toEqual(['chào']);
    for (let i = 0; i < 200; i++) chat.post(`p${i}`, 'X', `${i}`, 2000 + i);
    expect(chat.since(0)).toHaveLength(120);
    expect(chat.latest).toBe(202);
  });
});
