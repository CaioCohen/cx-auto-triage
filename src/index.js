globalThis.File ??= (await import('node:buffer')).File; // Safe on Node 20+, a no-op. Needed for older Node.
import app from './app.js';

const PORT = process.env.PORT || '3000';

process.on('unhandledRejection', err => console.error('UNHANDLED REJECTION', err));
process.on('uncaughtException', err => console.error('UNCAUGHT EXCEPTION', err));

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
