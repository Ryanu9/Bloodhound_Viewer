const path = require('path');

const express = require('express');

const { createApiRouter } = require('./routes/api');
const { DatasetStore } = require('./store/dataset-store');

async function main() {
  const app = express();
  const rootDir = path.resolve(__dirname, '..');
  const staticDir = path.join(rootDir, 'static');
  const dataDir = path.join(rootDir, 'data');
  const store = new DatasetStore(dataDir);

  await store.init();

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createApiRouter({ store }));
  app.use(express.static(staticDir, {
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    const detail = error.detail || error.message || 'Internal Server Error';
    res.status(status).json({ detail });
  });

  const port = Number.parseInt(process.env.PORT || '8000', 10);
  app.listen(port, () => {
    process.stdout.write(`BloodHound Viewer listening on http://127.0.0.1:${port}\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exit(1);
});
