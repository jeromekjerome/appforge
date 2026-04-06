import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from './app.js';
import { sql, initDb } from './db.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = createApp({ anthropic, sql, env: process.env });

const PORT = process.env.PORT || 3005;
initDb().then(() => {
  app.listen(PORT, () => console.log(`AppForge running on port ${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
