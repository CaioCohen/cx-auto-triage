// src/services/db_file.service.js
import OpenAI from 'openai';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DB_PATH = process.env.MOCK_DB_PATH || path.join(process.cwd(), 'data/mock_db.pdf');
const CACHE_DIR = path.join(process.cwd(), '.cache');
const ID_CACHE_FILE = path.join(CACHE_DIR, 'db_file_id.txt');

// Safe on Node 20+, a no-op. Needed for older Node.
globalThis.File ??= (await import('node:buffer')).File;

export async function ensureDbFileId() {
  // Creates cache dir if missing
  await fsp.mkdir(CACHE_DIR, { recursive: true });

  // keep a small cache on disk.
  try {
    const savedId = (await fsp.readFile(ID_CACHE_FILE, 'utf-8')).trim();
    if (savedId) return savedId;
  } catch {}

  // Upload the PDF as-is
  const file = await openai.files.create({
    file: fs.createReadStream(DB_PATH),
    purpose: 'assistants'
  });

  await fsp.writeFile(ID_CACHE_FILE, file.id, 'utf-8');
  return file.id;
}
