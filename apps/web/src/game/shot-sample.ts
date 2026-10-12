/** Extracts the first report from a burst recording, excluding intro silence and later shots. */
export function singleShotSample(source: AudioBuffer, context: Pick<AudioContext, 'createBuffer'>, seconds: number): AudioBuffer {
  const window = Math.max(1, Math.round(source.sampleRate * .002));
  const energy: number[] = [];
  for (let start = 0; start < source.length; start += window) {
    let sum = 0;
    const end = Math.min(source.length, start + window);
    for (let ch = 0; ch < source.numberOfChannels; ch++) {
      const data = source.getChannelData(ch);
      for (let i = start; i < end; i++) sum += data[i]! ** 2;
    }
    energy.push(sum / ((end - start) * source.numberOfChannels));
  }
  const peak = energy.reduce((max, value) => Math.max(max, value), 0);
  const onset = energy.findIndex(value => value > peak * .04);
  const offset = Math.max(0, (onset - 1) * window);
  const length = Math.min(source.length - offset, Math.max(1, Math.round(source.sampleRate * seconds)));
  const result = context.createBuffer(source.numberOfChannels, length, source.sampleRate);
  const fade = Math.max(1, Math.round(source.sampleRate * .008));
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const input = source.getChannelData(ch), output = result.getChannelData(ch);
    for (let i = 0; i < length; i++) output[i] = input[offset + i]! * Math.min(1, (length - 1 - i) / fade);
  }
  return result;
}
