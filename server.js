import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist');
const indexPath = path.join(distPath, 'index.html');

const app = express();
const port = Number(process.env.PORT) || 8080;
const host = '0.0.0.0';

app.use(express.static(distPath));

app.use((_req, res) => {
  res.sendFile(indexPath);
});

app.listen(port, host, () => {
  console.log(`Montran Global Map server listening on http://${host}:${port}`);
});
