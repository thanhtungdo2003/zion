/**
 * Estimates the server's clock from ping/pong round trips (NTP-style, smoothed). Used to render
 * remote entities slightly in the past and to tell the server which moment we were looking at
 * when attacking (lag compensation).
 */
export class ServerClock {
  private offset = 0;
  private initialized = false;
  rttMs = 0;

  /** Coarse initialisation from a server timestamp (assumes ~half a typical RTT). */
  seed(serverTime: number): void {
    if (this.initialized) return;
    this.offset = serverTime - performance.now() + 40;
    this.initialized = true;
  }

  onPong(clientSentAt: number, serverTime: number): void {
    const now = performance.now();
    const rtt = Math.max(0, now - clientSentAt);
    const sample = serverTime + rtt / 2 - now;
    if (!this.initialized || this.rttMs === 0) {
      this.offset = sample;
      this.rttMs = rtt;
      this.initialized = true;
      return;
    }
    this.rttMs += (rtt - this.rttMs) * 0.2;
    // Ignore samples from congested round trips; they skew the offset.
    if (rtt < this.rttMs * 2 + 20) this.offset += (sample - this.offset) * 0.15;
  }

  now(): number {
    return performance.now() + this.offset;
  }
}
