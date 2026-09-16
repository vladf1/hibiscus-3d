import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw new Error('Usage: node scripts/measure-live.mjs before|after');
const lighthouseRoot = process.env.LIGHTHOUSE_ROOT;
if (!lighthouseRoot) throw new Error('Set LIGHTHOUSE_ROOT to an installed Lighthouse package.');
const directory = resolve(`artifacts/live-${stage}`);
await mkdir(directory, { recursive: true });
const results = [];
const profiles = {
  desktop: ['--preset=desktop', '--throttling.requestLatencyMs=40', '--throttling.downloadThroughputKbps=10000', '--throttling.uploadThroughputKbps=10000', '--pause-after-load-ms=15000'],
  mobile: ['--throttling.requestLatencyMs=150', '--throttling.downloadThroughputKbps=1600', '--throttling.uploadThroughputKbps=750', '--throttling.cpuSlowdownMultiplier=4', '--pause-after-load-ms=70000'],
};
for (const [profile, options] of Object.entries(profiles)) {
  for (let run = 1; run <= 3; run++) {
    const path = `${directory}/${profile}-${run}.json`;
    let report;
    try { report = JSON.parse(await readFile(path, 'utf8')); } catch { /* New run. */ }
    if (!report) {
      await new Promise((done, reject) => {
        const child = spawn(process.execPath, [resolve(lighthouseRoot, 'cli/index.js'),
          'https://fridman.me/hibiscus-3d/', '--config-path=scripts/live-lighthouse.config.mjs',
          '--only-categories=performance,viewer', '--throttling-method=devtools',
          '--max-wait-for-load=90000', '--output=json', `--output-path=${path}`,
          '--chrome-flags=--headless', '--quiet', ...options], { stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? done() : reject(new Error(`Lighthouse exited ${code}`)));
      });
      report = JSON.parse(await readFile(path, 'utf8'));
    }
    const audit = report.audits['viewer-ready'];
    if (!Number.isFinite(audit?.numericValue)) throw new Error(`No 3D-ready timing in ${path}: ${audit?.errorMessage}`);
    const requests = report.audits['network-requests'].details.items;
    const modelRequests = requests.filter(request => request.url === audit.details.modelURL);
    if (modelRequests.length !== 1 || modelRequests[0].statusCode !== 200) throw new Error('Expected exactly one successful model request.');
    const model = modelRequests[0];
    const row = {
      profile, run, fetchTime: report.fetchTime, readyMs: audit.numericValue,
      posterMs: audit.details.poster ?? null, modelURL: model.url,
      modelTransferBytes: model.transferSize, modelResourceBytes: model.resourceSize,
      modelDownloadMs: model.networkEndTime - model.networkRequestTime,
      totalTransferBytes: requests.reduce((sum, request) => sum + request.transferSize, 0),
    };
    if (results.some(previous => previous.modelURL !== row.modelURL)) throw new Error('Live model changed during measurement batch.');
    results.push(row);
    await writeFile(`${directory}/results.json`, JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(row));
  }
}
