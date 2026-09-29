import { execFileSync, execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

// M10 media pipeline helpers for e2e (local stack only): run the transform worker once, run the
// media orchestrator, and make a unique photo in the browser (so reruns never hit duplicate checks).

const API = 'http://127.0.0.1:54321';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

let cachedKey: string | null = null;
/** The LOCAL stack's service key (CI exports it; locally read from the CLI). Never a hosted key. */
function localServiceKey(): string {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = fromEnv
    ? `SERVICE_ROLE_KEY=${fromEnv}`
    : execSync('npx supabase status -o env', { cwd: repo, encoding: 'utf8' });
  const m = /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(out);
  if (!m) throw new Error('local service key not found');
  cachedKey = m[1]!;
  return cachedKey;
}

export function runMediaWorker(): {
  claimed: number;
  classify: number;
  rejected: number;
  retry: number;
} {
  const out = execFileSync(process.execPath, ['--experimental-strip-types', 'src/once.ts'], {
    cwd: resolve(repo, 'apps/media-worker'),
    env: { ...process.env, SUPABASE_URL: API, SUPABASE_SERVICE_ROLE_KEY: localServiceKey() },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop()!);
}

/** local-only value from supabase/config.toml [edge_runtime.secrets] */
export async function runMediaOrchestrator() {
  const res = await fetch(`${API}/functions/v1/media-orchestrator`, {
    method: 'POST',
    headers: { 'x-media-secret': 'local-media-secret' },
  });
  return (await res.json()) as {
    mode: string;
    published: number;
    classified: Record<string, number>;
  };
}

/** A unique, photo-like JPEG (random gradient + shapes) drawn in the page. */
export async function uniquePhoto(page: Page, name = 'result.jpg') {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 1500;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 1200, 1500);
    grad.addColorStop(0, `hsl(${Math.random() * 360} 60% 50%)`);
    grad.addColorStop(1, `hsl(${Math.random() * 360} 60% 40%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 1200, 1500);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `hsla(${Math.random() * 360} 70% 60% / 0.6)`;
      g.beginPath();
      g.arc(Math.random() * 1200, Math.random() * 1500, 30 + Math.random() * 200, 0, Math.PI * 2);
      g.fill();
    }
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
