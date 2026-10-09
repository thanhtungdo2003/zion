/** Lightweight in-process metrics, exported in Prometheus text format via /metrics. */
export class Metrics {
  connections = 0;
  players = 0;
  messagesIn = 0;
  bytesOut = 0;
  droppedSnapshots = 0;
  rejectedUpgrades: Record<string, number> = {};
  anticheatFlags = 0;
  kicks = 0;
  chunksSent = 0;
  tickCount = 0;
  tickOverruns = 0;
  private tickWindow: number[] = [];

  recordTick(ms: number, budgetMs: number): void {
    this.tickCount++;
    if (ms > budgetMs) this.tickOverruns++;
    this.tickWindow.push(ms);
    if (this.tickWindow.length > 300) this.tickWindow.shift();
  }

  reject(reason: string): void {
    this.rejectedUpgrades[reason] = (this.rejectedUpgrades[reason] ?? 0) + 1;
  }

  tickStats(): { avg: number; p99: number; max: number } {
    if (this.tickWindow.length === 0) return { avg: 0, p99: 0, max: 0 };
    const sorted = [...this.tickWindow].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    return { avg, p99: sorted[Math.floor(sorted.length * 0.99)]!, max: sorted[sorted.length - 1]! };
  }

  render(extra: Record<string, number>): string {
    const t = this.tickStats();
    const lines: string[] = [];
    const g = (name: string, v: number, help: string, type = 'gauge') => {
      lines.push(`# HELP zion_${name} ${help}`, `# TYPE zion_${name} ${type}`, `zion_${name} ${v}`);
    };
    g('connections', this.connections, 'Open WebSocket connections');
    g('players', this.players, 'Players in world');
    g('messages_in_total', this.messagesIn, 'Inbound WebSocket messages', 'counter');
    g('bytes_out_total', this.bytesOut, 'Outbound WebSocket bytes', 'counter');
    g('snapshots_dropped_total', this.droppedSnapshots, 'Snapshots skipped due to backpressure', 'counter');
    g('anticheat_flags_total', this.anticheatFlags, 'Anti-cheat suspicion events', 'counter');
    g('kicks_total', this.kicks, 'Players kicked', 'counter');
    g('chunks_sent_total', this.chunksSent, 'Chunk frames sent', 'counter');
    g('ticks_total', this.tickCount, 'Simulation ticks', 'counter');
    g('tick_overruns_total', this.tickOverruns, 'Ticks exceeding budget', 'counter');
    g('tick_ms_avg', Number(t.avg.toFixed(3)), 'Average tick duration (ms)');
    g('tick_ms_p99', Number(t.p99.toFixed(3)), 'p99 tick duration (ms)');
    for (const [k, v] of Object.entries(extra)) g(k, v, k.replace(/_/g, ' '));
    lines.push('# HELP zion_upgrades_rejected_total Rejected WebSocket upgrades', '# TYPE zion_upgrades_rejected_total counter');
    for (const [reason, v] of Object.entries(this.rejectedUpgrades)) {
      lines.push(`zion_upgrades_rejected_total{reason="${reason}"} ${v}`);
    }
    return lines.join('\n') + '\n';
  }
}
