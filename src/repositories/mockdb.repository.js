import fs from 'fs/promises';
import path from 'path';
import url from 'url';

/* ---------- DB loader ---------- */

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DB_PATH = process.env.MOCK_DB_PATH || path.join(__dirname, '../../data/mock_db.json');

export async function loadDbText() {
  try {
    return await fs.readFile(DB_PATH, 'utf-8');
  } catch {
    return null;
  }
}
