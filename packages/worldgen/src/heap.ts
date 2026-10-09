/**
 * Binary min-heap of grid indices keyed by (priority, insertion order). The insertion-order
 * tie-break makes processing order — and therefore hydrology — fully deterministic.
 */
export class IndexHeap {
  private idx: Int32Array;
  private pri: Float64Array;
  private ord: Float64Array;
  private n = 0;
  private counter = 0;

  constructor(capacity: number) {
    this.idx = new Int32Array(capacity);
    this.pri = new Float64Array(capacity);
    this.ord = new Float64Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  private less(a: number, b: number): boolean {
    const pa = this.pri[a]!;
    const pb = this.pri[b]!;
    return pa < pb || (pa === pb && this.ord[a]! < this.ord[b]!);
  }

  private swap(a: number, b: number): void {
    const i = this.idx[a]!;
    this.idx[a] = this.idx[b]!;
    this.idx[b] = i;
    const p = this.pri[a]!;
    this.pri[a] = this.pri[b]!;
    this.pri[b] = p;
    const o = this.ord[a]!;
    this.ord[a] = this.ord[b]!;
    this.ord[b] = o;
  }

  push(index: number, priority: number): void {
    if (this.n === this.idx.length) this.grow();
    let k = this.n++;
    this.idx[k] = index;
    this.pri[k] = priority;
    this.ord[k] = this.counter++;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!this.less(k, parent)) break;
      this.swap(k, parent);
      k = parent;
    }
  }

  pop(): number {
    if (this.n === 0) throw new RangeError('heap empty');
    const top = this.idx[0]!;
    this.n--;
    if (this.n > 0) {
      this.idx[0] = this.idx[this.n]!;
      this.pri[0] = this.pri[this.n]!;
      this.ord[0] = this.ord[this.n]!;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === k) break;
        this.swap(k, m);
        k = m;
      }
    }
    return top;
  }

  private grow(): void {
    const cap = this.idx.length * 2;
    const idx = new Int32Array(cap);
    idx.set(this.idx);
    const pri = new Float64Array(cap);
    pri.set(this.pri);
    const ord = new Float64Array(cap);
    ord.set(this.ord);
    this.idx = idx;
    this.pri = pri;
    this.ord = ord;
  }
}
