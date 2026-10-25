import { createHash } from 'node:crypto';
// Local release gate: no deployment, accounts, secrets, or paid bindings.
import { build } from 'esbuild';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const report = { started_at: new Date().toISOString(), node: process.version, checks: [] };
try { report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { report.commit = null; }
const output = join(root, '.wrangler', 'release-report.json');
const persist = async () => { await mkdir(join(root, '.wrangler'), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
try {
  await build({ entryPoints: [join(root, 'src/worker.js')], bundle: true, format: 'esm', platform: 'browser', loader: { '.txt': 'text' }, outfile: join(root, 'worker-code.txt') });
  report.worker_sha256 = createHash('sha256').update(await readFile(join(root, 'worker-code.txt'))).digest('hex');
  report.checks.push({ name: 'Worker build', status: 'passed' });
  for (const [name, args] of [
    ['Workers regression suite', ['--test']],
    ['Table browser workflow', ['scripts/check-browser.mjs']],
    ['Interpretation browser workflow', ['scripts/check-lab-browser.mjs']],
    ['JavaScript renderer browser workflow', ['scripts/check-renderer-browser.mjs']],
    ['Source URL fetch and fallback browser workflow', ['scripts/check-source-browser.mjs']],
    ['Cloudflare bundle dry run', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run']],
  ]) {
    process.stdout.write('\nChecking: ' + name + '\n');
    const started = Date.now();
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: {
        ...process.env, WRANGLER_SEND_METRICS: 'false',
        ...(process.platform !== 'win32' && !process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: join(root, '.wrangler', 'release-config') } : {}),
      } });
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
    report.checks.push({ name, status: code === 0 ? 'passed' : 'failed', exit_code: code, duration_ms: Date.now() - started });
    await persist();
    if (code !== 0) { process.exitCode = code; throw Error(name + ' failed; remaining checks were not run.'); }
  }
  report.status = 'passed';
  process.stdout.write('\nPASS: all local release checks. No deployment performed.\n');
} catch (error) {
  report.status = 'failed'; report.error = error.message;
  process.stderr.write(error.message + '\n');
  process.exitCode ||= 1;
} finally {
  report.completed_at = new Date().toISOString();
  await persist();
  process.stdout.write('Report: ' + output + '\n');
}
