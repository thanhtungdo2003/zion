'use strict';
/**
 * ZION desktop: serves the bundled web client (a static export) on this machine and shows it in
 * a game window. One local origin serves everything: pages and assets from the bundle, and
 * /api plus the game WebSocket proxied to the online server (named in config.json beside the exe),
 * so cookies are first-party and the server sees the website's own Origin.
 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build');
/** Fixed ports keep the page's origin (and so its saved settings and login) the same every launch. */
const PORTS = [47820, 47821, 47822, 47823, 47824];

function loadConfig() {
  for (const file of [path.join(path.dirname(process.execPath), 'config.json'), path.join(RES, 'config.json'), path.join(__dirname, 'config.json')]) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* next */ }
  }
  return {};
}

const config = loadConfig();
const API = new URL(config.apiUrl || 'http://localhost:4000');
/** The website's origin: the server only accepts requests and sockets from origins it allows. */
const WEB_ORIGIN = config.webOrigin || API.origin;
/** Where the game socket really lives (learnt from the ticket the API hands out). */
let remoteWs = new URL('/ws', API.origin.replace(/^http/, 'ws'));

const listen = (server, port) => new Promise((resolve) => {
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => resolve(true));
});

const WEB_ROOT = path.join(RES, 'web');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bbmodel': 'application/json', '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ktx2': 'image/ktx2',
};

/** The bundled web client (a static export): /play → play.html or play/index.html. */
function serveFile(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  const base = path.normalize(path.join(WEB_ROOT, rel));
  if (!base.startsWith(WEB_ROOT)) { res.writeHead(403); res.end(); return; }
  const candidates = [base, `${base}.html`, path.join(base, 'index.html')];
  const file = candidates.find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
  if (!file) {
    const notFound = path.join(WEB_ROOT, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    if (fs.existsSync(notFound)) fs.createReadStream(notFound).pipe(res); else res.end('Not found');
    return;
  }
  const stat = fs.statSync(file), type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type, 'content-length': String(stat.size), 'cache-control': file.endsWith('.html') || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600' };
  if (req.method === 'HEAD') { res.writeHead(200, headers); res.end(); return; }
  // Ranges (audio seeking).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const startAt = range[1] ? Number(range[1]) : stat.size - Number(range[2]), endAt = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    if (startAt >= 0 && startAt <= endAt && endAt < stat.size) {
      res.writeHead(206, { ...headers, 'content-length': String(endAt - startAt + 1), 'content-range': `bytes ${startAt}-${endAt}/${stat.size}`, 'accept-ranges': 'bytes' });
      fs.createReadStream(file, { start: startAt, end: endAt }).pipe(res);
      return;
    }
  }
  res.writeHead(200, { ...headers, 'accept-ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

function cookieForLocal(c) {
  // The page is plain http on 127.0.0.1: drop Secure and Domain so the browser keeps the cookie.
  return c.replace(/;\s*secure/gi, '').replace(/;\s*domain=[^;]*/gi, '');
}

function forward(req, res, localPort) {
  const target = API;
  const headers = { ...req.headers, host: target.host };
  // The server accepts the website's Origin only; plain bodies so the ticket can be rewritten.
  if (headers.origin) headers.origin = WEB_ORIGIN;
  delete headers.referer;
  headers['accept-encoding'] = 'identity';
  const lib = target.protocol === 'https:' ? https : http;
  const up = lib.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: req.method, path: req.url, headers }, (ur) => {
    const h = { ...ur.headers };
    for (const k of Object.keys(h)) if (k.startsWith('access-control-')) delete h[k];
    if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].map(cookieForLocal);
    if (String(h['content-type'] || '').includes('json')) {
      // The game ticket names the socket URL: point it at this proxy instead.
      const chunks = [];
      ur.on('data', (c) => chunks.push(c));
      ur.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        body = body.replace(/"wsUrl":"([^"]+)"/, (_m, url) => {
          try { remoteWs = new URL(JSON.parse(`"${url}"`)); } catch { return _m; }
          return `"wsUrl":"ws://127.0.0.1:${localPort}${remoteWs.pathname}${remoteWs.search}"`;
        });
        const buf = Buffer.from(body, 'utf8');
        delete h['transfer-encoding'];
        h['content-length'] = String(buf.length);
        res.writeHead(ur.statusCode || 502, h);
        res.end(buf);
      });
      return;
    }
    res.writeHead(ur.statusCode || 502, h);
    ur.pipe(res);
  });
  up.on('error', (err) => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad_gateway', message: `Không kết nối được máy chủ game (${err.code || err.message}).` }));
  });
  req.pipe(up);
}

function proxySocket(req, socket, head) {
  const target = remoteWs;
  const lib = target.protocol === 'wss:' ? https : http;
  const headers = { ...req.headers, host: target.host, origin: WEB_ORIGIN };
  const up = lib.request({ hostname: target.hostname, port: target.port || (target.protocol === 'wss:' ? 443 : 80), path: req.url, method: 'GET', headers });
  up.on('upgrade', (ur, upSocket, upHead) => {
    const lines = [`HTTP/1.1 ${ur.statusCode} ${ur.statusMessage}`];
    for (let i = 0; i < ur.rawHeaders.length; i += 2) lines.push(`${ur.rawHeaders[i]}: ${ur.rawHeaders[i + 1]}`);
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upHead && upHead.length) socket.write(upHead);
    if (head && head.length) upSocket.write(head);
    upSocket.setNoDelay(true); socket.setNoDelay(true);
    upSocket.pipe(socket).pipe(upSocket);
    const close = () => { upSocket.destroy(); socket.destroy(); };
    upSocket.on('error', close); socket.on('error', close);
    upSocket.on('close', close); socket.on('close', close);
  });
  up.on('response', (ur) => { socket.end(`HTTP/1.1 ${ur.statusCode} ${ur.statusMessage}\r\n\r\n`); });
  up.on('error', () => socket.destroy());
  up.end();
}

async function startServer() {
  if (!fs.existsSync(path.join(WEB_ROOT, 'index.html'))) throw new Error(`Thiếu bản web đóng gói: ${WEB_ROOT}`);
  let localPort = 0;
  const server = http.createServer((req, res) => {
    // The Studios are for the website only: the app just plays the game.
    if (/^\/(api\/)?studio(\/|\?|\.|$)/.test(req.url)) {
      if (req.url.startsWith('/api/')) { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"forbidden","message":"Studio chỉ mở trên web."}'); }
      else { res.writeHead(302, { location: '/' }); res.end(); }
      return;
    }
    if (req.url.startsWith('/api/') || req.url === '/api') forward(req, res, localPort);
    else serveFile(req, res);
  });
  server.on('upgrade', (req, socket, head) => proxySocket(req, socket, head));
  for (const port of PORTS) if (await listen(server, port)) { localPort = port; return port; }
  if (await listen(server, 0)) { localPort = server.address().port; return localPort; }
  throw new Error('Không mở được cổng cục bộ cho game.');
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 600, backgroundColor: '#05070a', title: 'ZION', show: false,
    autoHideMenuBar: true, icon: path.join(RES, 'web', 'pwa', 'icon-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const home = `http://127.0.0.1:${port}`;
  win.once('ready-to-show', () => win.show());
  // Links to other sites open in the system browser; the game stays in its window.
  win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(home)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(home)) { e.preventDefault(); void shell.openExternal(url); } });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F12' && input.control && input.shift) win.webContents.toggleDevTools();
  });
  void win.loadURL(`${home}/`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      createWindow(await startServer());
    } catch (err) {
      dialog.showErrorBox('ZION', String(err && err.message || err));
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
