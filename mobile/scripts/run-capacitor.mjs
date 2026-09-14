import { spawn } from 'node:child_process';

const [environment, ...capacitorArgs] = process.argv.slice(2);
const allowedEnvironments = new Set(['store', 'remote-dev']);

if (!allowedEnvironments.has(environment) || capacitorArgs.length === 0) {
  console.error('Usage: node scripts/run-capacitor.mjs <store|remote-dev> <capacitor command...>');
  process.exit(2);
}

const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(executable, ['cap', ...capacitorArgs], {
  stdio: 'inherit',
  env: {
    ...process.env,
    UNBOUND_MOBILE_ENV: environment
  }
});

child.on('error', (error) => {
  console.error(`Could not start Capacitor: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Capacitor exited from signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
