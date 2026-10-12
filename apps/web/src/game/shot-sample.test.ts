import { describe, expect, it } from 'vitest';
import { singleShotSample } from './shot-sample';

function buffer(channels: number, length: number, sampleRate: number): AudioBuffer {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, getChannelData: (ch: number) => data[ch]! } as AudioBuffer;
}

describe('burst recording extraction', () => {
  it('removes intro silence, excludes subsequent reports and fades the cut without losing stereo', () => {
    const source = buffer(2, 1000, 1000);
    for (let ch = 0; ch < 2; ch++) {
      source.getChannelData(ch).fill(ch ? .5 : 1, 200, 260);
      source.getChannelData(ch).fill(1, 310, 400);
    }
    const shot = singleShotSample(source, { createBuffer: buffer }, .1);
    expect(shot.length).toBe(100);
    expect(shot.numberOfChannels).toBe(2);
    expect(shot.getChannelData(0)[2]).toBe(1);
    expect(shot.getChannelData(1)[2]).toBe(.5);
    expect(shot.getChannelData(0)[99]).toBe(0);
    expect(shot.getChannelData(0).slice(62).every(value => value === 0)).toBe(true);
  });
  it('handles silent and very short recordings', () => {
    const shot = singleShotSample(buffer(1, 2, 1000), { createBuffer: buffer }, .1);
    expect(shot.length).toBe(2);
    expect([...shot.getChannelData(0)]).toEqual([0, 0]);
  });
});
