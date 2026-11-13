// Password login for the CRM (needed once it is public on Vercel).
// Set CRM_PASSWORD (and ideally SESSION_SECRET) in the environment.
const crypto = require('crypto');

const COOKIE = 'crm_session';
const MAX_AGE_S = 30 * 24 * 3600;

const required = () => !!process.env.CRM_PASSWORD || !!process.env.VERCEL;
const secret = () => process.env.SESSION_SECRET || crypto.createHash('sha256').update('wacrm:' + (process.env.CRM_PASSWORD || '')).digest('hex');
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function readCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function isAuthed(req) {
  if (!required()) return true;
  const v = readCookie(req);
  if (!v) return false;
  const [exp, sig] = v.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return same(sig, sign(exp));
}

function setSession(req, res) {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
  const secure = req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`);
}
const clearSession = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

function routes(app) {
  app.get('/api/me', (req, res) => res.json({ required: required(), authed: isAuthed(req), configured: !!process.env.CRM_PASSWORD }));
  app.post('/api/login', (req, res) => {
    if (!process.env.CRM_PASSWORD) return res.status(500).json({ error: 'CRM_PASSWORD is not set on the server' });
    if (!same(req.body?.password || '', process.env.CRM_PASSWORD)) return res.status(401).json({ error: 'Wrong password' });
    setSession(req, res);
    res.json({ ok: true });
  });
  app.post('/api/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });
  // everything else under /api needs a session
  app.use('/api', (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: 'Login required' })));
}

module.exports = { routes, isAuthed, required };
