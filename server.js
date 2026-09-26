const express = require('express');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const reportsDir = path.join(__dirname, 'reports');
const jobs = new Map();
let activeScan = false;
app.disable('x-powered-by');
app.use(express.json({ limit: '4kb' }));
app.use('/reports', express.static(reportsDir, { index: false, dotfiles: 'deny' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/scans', (req, res) => {
  if (activeScan) {
    return res.status(429).set('Retry-After', '10').json({
      error: 'Şu anda başka bir site taranıyor. Mevcut tarama bittikten sonra tekrar deneyin.',
    });
  }
  let url;
  try {
    const input = req.body?.url;
    if (typeof input !== 'string' || !/^https?:\/\//i.test(input.trim())) throw new Error();
    url = new URL(input.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
  } catch {
    return res.status(400).json({ error: 'Geçerli bir http:// veya https:// URL girin.' });
  }

  const id = randomUUID();
  const reportDir = path.join(reportsDir, id);
  const job = { status: 'running' };
  jobs.set(id, job);
  // Async işlemden önce kilitle; aynı anda ikinci süreç açılmaz.
  activeScan = true;
  let child;
  try {
    child = spawn(process.execPath, [path.join(__dirname, 'scan.js'), url.href], {
      cwd: __dirname,
      env: { ...process.env, SCAN_REPORT_DIR: reportDir },
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
  } catch (error) {
    activeScan = false;
    jobs.delete(id);
    console.error('Tarama başlatılamadı:', error);
    return res.status(500).json({ error: 'Tarama başlatılamadı. Lütfen yeniden deneyin.' });
  }
  child.once('error', error => {
    console.error('Tarama başlatılamadı:', error);
    job.status = 'failed';
  });
  child.once('close', code => {
    // error sonrası da close gelir; süreç kapanana kadar kilit korunur.
    activeScan = false;
    if (code === 0 && fs.existsSync(path.join(reportDir, 'rapor.html'))) {
      job.status = 'completed';
      job.reportUrl = `/reports/${id}/rapor.html`;
    } else {
      job.status = 'failed';
    }
    setTimeout(() => jobs.delete(id), 24 * 60 * 60 * 1000).unref();
  });
  res.status(202).json({ id });
});

app.get('/api/scans/:id', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tarama bulunamadı. Lütfen yeniden deneyin.' });
  res.json(job);
});

app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(error.status || 500).json({ error: 'İstek işlenemedi. Lütfen yeniden deneyin.' });
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`Vidius QA Scanner: port ${process.env.PORT || 3000}`);
});
