// One command to run the bot: starts the ngrok tunnel and the CRM server,
// and restarts either one if it crashes.  Usage:  npm run bot
const { spawn } = require('child_process');
const path = require('path');

const procs = {};
function run(name, script, delayMs = 0) {
  setTimeout(() => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], { stdio: ['ignore', 'pipe', 'pipe'] });
    procs[name] = child;
    const tag = name === 'tunnel' ? '[tunnel]' : '[server]';
    child.stdout.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => `${tag} ${l}\n`).join('')));
    child.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));
    child.on('exit', (code) => {
      if (stopping) return;
      console.log(`${tag} exited (code ${code}) — restarting in 5s`);
      run(name, script, 5000);
    });
  }, delayMs);
}

let stopping = false;
const stop = () => { stopping = true; for (const p of Object.values(procs)) try { p.kill(); } catch (_) {} setTimeout(() => process.exit(0), 500); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log('Starting WaCRM: tunnel + server (Ctrl+C to stop)\n');
run('tunnel', 'tunnel.js');
run('server', 'server.js', 1500);
