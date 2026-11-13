// Opens an ngrok HTTPS tunnel in-process using the official @ngrok/ngrok SDK
// (no separate ngrok.exe needed, always a current agent version).
const fs = require('fs');
const os = require('os');
const path = require('path');
const ngrok = require('@ngrok/ngrok');

const state = { publicUrl: null, status: 'idle', error: null, listener: null };

// Reuse the authtoken you already saved with `ngrok config add-authtoken ...`
function findAuthtoken() {
  if (process.env.NGROK_AUTHTOKEN) return process.env.NGROK_AUTHTOKEN;
  const home = os.homedir();
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ngrok', 'ngrok.yml'),
    path.join(home, 'AppData', 'Local', 'ngrok', 'ngrok.yml'),
    path.join(home, 'Library', 'Application Support', 'ngrok', 'ngrok.yml'),
    path.join(home, '.config', 'ngrok', 'ngrok.yml'),
    path.join(home, '.ngrok2', 'ngrok.yml'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const m = fs.readFileSync(file, 'utf8').match(/authtoken:\s*["']?([\w-]+)/);
      if (m) return m[1];
    } catch (_) { /* not here */ }
  }
  return null;
}

// If an ngrok CLI tunnel for this port is already running, reuse it
async function findCliTunnel(port) {
  for (const apiPort of [4040, 4041]) {
    try {
      const res = await fetch(`http://127.0.0.1:${apiPort}/api/tunnels`, { signal: AbortSignal.timeout(1000) });
      if (!res.ok) continue;
      const { tunnels = [] } = await res.json();
      const t = tunnels.find((t) => t.public_url.startsWith('https') && String(t.config && t.config.addr).endsWith(':' + port));
      if (t) return t.public_url;
    } catch (_) {}
  }
  return null;
}

async function start(port) {
  state.status = 'starting';
  state.error = null;
  try {
    const existing = await findCliTunnel(port);
    if (existing) {
      Object.assign(state, { publicUrl: existing, status: 'online' });
      return existing;
    }
    const authtoken = findAuthtoken();
    if (!authtoken) throw new Error('No ngrok authtoken found. Run: ngrok config add-authtoken <token>  (or set NGROK_AUTHTOKEN in .env)');
    const opts = { addr: port, authtoken };
    if (process.env.NGROK_DOMAIN) opts.domain = process.env.NGROK_DOMAIN.replace(/^https?:\/\//, '');
    state.listener = await ngrok.forward(opts);
    Object.assign(state, { publicUrl: state.listener.url(), status: 'online' });
    return state.publicUrl;
  } catch (e) {
    Object.assign(state, { status: 'error', publicUrl: null, error: String(e.message || e).slice(0, 400) });
    return null;
  }
}

async function stop() {
  try { if (state.listener) await state.listener.close(); } catch (_) {}
  state.listener = null;
  state.publicUrl = null;
  state.status = 'stopped';
}

module.exports = { state, start, stop };
