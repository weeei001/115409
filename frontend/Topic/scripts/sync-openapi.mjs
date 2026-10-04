/**
 * 從 NEXT_PUBLIC_API_URL 下載 /openapi.json 寫入專案根目錄。
 * 讀取順序：.env.local → .env.development → .env
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

['.env.local', '.env.development', '.env'].forEach(loadEnvFile);

const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const url = `${base}/openapi.json`;
const out = path.join(root, 'openapi.json');

const res = await fetch(url);
if (!res.ok) {
  console.error(`Failed ${res.status} ${res.statusText}: ${url}`);
  process.exit(1);
}

const spec = await res.json();
fs.writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
const paths = Object.keys(spec.paths ?? {});
console.log(`Wrote ${out} (${paths.length} paths) from ${url}`);
