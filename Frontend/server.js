// Minimal Node server for Databricks Apps.
// Serves the built React app (dist/) and is the place to add API routes
// that query a Databricks SQL warehouse later (see README → "Connect real data").
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Example placeholder for a real data route:
// app.post('/api/summary', async (req, res) => { /* build SQL from req.body, query warehouse */ });

const dist = path.join(__dirname, 'dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
app.listen(port, () => console.log(`Insights Accelerator running on port ${port}`));
