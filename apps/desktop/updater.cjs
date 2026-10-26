'use strict';
/**
 * Content updates for the desktop app. The game itself (pages, scripts, models, textures, sounds)
 * is a set of files described by a manifest { version, builtAt, files: { path: [sha256, size] } }.
 *
 * - The app ships with one set (resources/web + resources/web-manifest.json).
 * - The server publishes the newest manifest and every file as a blob named by its hash
 *   (GET /api/desktop/manifest, /api/desktop/blobs/<sha256>; see apps/server/src/http/routes/desktop.ts).
 * - Files the app lacks are downloaded into <userData>/content/blobs, each verified against its
 *   hash before it is kept; files unchanged since the shipped set are read from the install folder.
 * - A new set only takes effect once complete, at the next start or reload: a running game never
 *   sees half an update, and an interrupted download resumes where it stopped.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const PARALLEL = 6;
const MANIFEST_TIMEOUT_MS = 6000;
const BLOB_TIMEOUT_MS = 60000;

function readJson(file) {
  try { const m = JSON.parse(fs.readFileSync(file, 'utf8')); return m && typeof m.files === 'object' ? m : null; } catch { return null; }
}

function get(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { headers: { 'user-agent': 'ZION-desktop' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      resolve(res);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

class ContentStore {
  /** @param {{ bundledDir: string, bundledManifest: string, dataDir: string, apiOrigin: string }} o */
  constructor(o) {
    this.bundledDir = o.bundledDir;
    this.bundled = readJson(o.bundledManifest);
    this.root = path.join(o.dataDir, 'content');
    this.blobs = path.join(this.root, 'blobs');
    this.activeFile = path.join(this.root, 'active.json');
    /** The set being downloaded: its finished blobs survive a restart (gc keeps them). */
    this.incomingFile = path.join(this.root, 'incoming.json');
    this.api = o.apiOrigin;
    /** The set being served now; a newer complete one waits in `pending` until activate(). */
    this.current = this.bundled;
    this.pending = null;
  }

  get version() { return this.current ? this.current.version : 'dev'; }

  /** Picks the newest complete set (downloaded or shipped) and clears blobs nothing uses. */
  load() {
    const active = readJson(this.activeFile);
    if (active && (!this.bundled || active.builtAt >= this.bundled.builtAt) && this.complete(active)) this.current = active;
    this.gc();
  }

  /** Absolute file for a manifest path, or null. Without a manifest (a dev build), the plain folder. */
  resolve(rel) {
    if (!this.current) {
      const file = path.normalize(path.join(this.bundledDir, rel));
      return file.startsWith(this.bundledDir) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
    }
    const entry = this.current.files[rel];
    if (!entry) return null;
    return this.local(rel, entry[0]);
  }

  /** Where a file with this hash already is on disk: the install folder or the blob store. */
  local(rel, sha) {
    const shipped = this.bundled && this.bundled.files[rel];
    if (shipped && shipped[0] === sha) return path.join(this.bundledDir, ...rel.split('/'));
    const blob = path.join(this.blobs, sha);
    return fs.existsSync(blob) ? blob : null;
  }

  complete(m) {
    return Object.entries(m.files).every(([rel, [sha]]) => this.local(rel, sha) || this.shippedElsewhere(sha));
  }

  /** The same content under another path in the shipped set (renamed files need no download). */
  shippedElsewhere(sha) {
    if (!this.bundled) return null;
    if (!this.bySha) { this.bySha = new Map(); for (const [rel, [s]] of Object.entries(this.bundled.files)) this.bySha.set(s, rel); }
    const rel = this.bySha.get(sha);
    return rel ? path.join(this.bundledDir, ...rel.split('/')) : null;
  }

  /**
   * Fetches the server's manifest and downloads what is missing.
   * @returns {Promise<{ state: 'current' | 'ready' | 'offline' | 'unpublished', version?: string, error?: string }>}
   * @param {(done: number, total: number) => void} [progress] bytes downloaded so far / to download
   */
  async check(progress) {
    let remote;
    try {
      const res = await get(new URL('/api/desktop/manifest', this.api), MANIFEST_TIMEOUT_MS);
      const chunks = [];
      for await (const c of res) chunks.push(c);
      remote = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!remote || typeof remote.files !== 'object' || typeof remote.version !== 'string') throw new Error('bad manifest');
    } catch (err) {
      return { state: /HTTP 404/.test(String(err && err.message)) ? 'unpublished' : 'offline', error: String(err && err.message || err) };
    }
    const target = this.pending || this.current;
    if (target && target.version === remote.version) return { state: 'current', version: remote.version };
    // Wanted blobs, each once.
    const want = new Map();
    for (const [rel, [sha, size]] of Object.entries(remote.files)) {
      if (!/^[0-9a-f]{64}$/.test(sha)) return { state: 'offline', error: 'bad manifest entry' };
      if (!this.local(rel, sha) && !this.shippedElsewhere(sha)) want.set(sha, size);
    }
    const total = [...want.values()].reduce((s, n) => s + n, 0);
    let done = 0;
    fs.mkdirSync(this.blobs, { recursive: true });
    fs.writeFileSync(this.incomingFile, JSON.stringify(remote));
    const queue = [...want.keys()];
    const worker = async () => {
      for (let sha = queue.shift(); sha; sha = queue.shift()) {
        await this.download(sha, (n) => { done += n; if (progress) progress(done, total); });
      }
    };
    try {
      await Promise.all(Array.from({ length: PARALLEL }, worker));
    } catch (err) {
      return { state: 'offline', error: String(err && err.message || err) };
    }
    // Paths whose content was shipped under another name: copy them into the blob store.
    for (const [rel, [sha]] of Object.entries(remote.files)) {
      if (this.local(rel, sha)) continue;
      const from = this.shippedElsewhere(sha);
      if (from) fs.copyFileSync(from, path.join(this.blobs, sha));
    }
    const tmp = `${this.activeFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(remote));
    fs.renameSync(tmp, this.activeFile);
    fs.rmSync(this.incomingFile, { force: true });
    this.pending = remote;
    return { state: 'ready', version: remote.version };
  }

  async download(sha, onBytes) {
    const file = path.join(this.blobs, sha), part = `${file}.part`;
    const res = await get(new URL(`/api/desktop/blobs/${sha}`, this.api), BLOB_TIMEOUT_MS);
    const hash = crypto.createHash('sha256'), out = fs.createWriteStream(part);
    await new Promise((resolve, reject) => {
      res.on('data', (c) => { hash.update(c); onBytes(c.length); });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    });
    if (hash.digest('hex') !== sha) { fs.rmSync(part, { force: true }); throw new Error(`corrupt download ${sha.slice(0, 8)}`); }
    fs.renameSync(part, file);
  }

  /** Switches to the downloaded set (call before the page loads or reloads). */
  activate() {
    if (!this.pending) return false;
    this.current = this.pending; this.pending = null;
    return true;
  }

  /** Removes blobs neither the current nor a pending set refers to. */
  gc() {
    let names;
    try { names = fs.readdirSync(this.blobs); } catch { return; }
    const keep = new Set();
    for (const m of [this.current, this.pending, readJson(this.activeFile), readJson(this.incomingFile)]) if (m) for (const [sha] of Object.values(m.files)) keep.add(sha);
    for (const name of names) if (!keep.has(name)) fs.rmSync(path.join(this.blobs, name), { force: true });
  }
}

module.exports = { ContentStore };
