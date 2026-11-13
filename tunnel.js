// Keeps the ngrok tunnel open in its own process, so restarting the CRM server
// doesn't change the public webhook URL. Run once: `npm run tunnel`
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ngrok = require('./lib/ngrok');

const PORT = Number(process.env.PORT) || 3000;
const FILE = path.join(__dirname, 'data', 'tunnel.json');

(async () => {
  const url = await ngrok.start(PORT);
  if (!url) {
    console.error('ngrok failed:', ngrok.state.error);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ url, port: PORT, at: new Date().toISOString() }, null, 2));
  console.log(`Tunnel open  →  ${url}  →  http://localhost:${PORT}`);
  console.log(`Webhook URL  →  ${url}/webhook`);
  console.log(`Verify token →  ${process.env.WA_VERIFY_TOKEN}`);
  setInterval(() => {}, 1 << 30); // stay alive
})();

const stop = async () => { try { fs.unlinkSync(FILE); } catch (_) {} await ngrok.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
