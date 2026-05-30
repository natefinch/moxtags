import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const EXTENSION_PATH = join(ROOT, 'dist', 'chrome');

export async function launchExtensionContext() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'moxtags-playwright-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    serviceWorkers: 'allow',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  const extensionId = serviceWorker.url().split('/')[2];

  async function close() {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }

  return { context, extensionId, serviceWorker, close };
}

export async function installNetworkGuard(context, options = {}) {
  const violations = [];
  const allowedProtocols = new Set([
    'about:',
    'blob:',
    'chrome-extension:',
    'data:',
  ]);
  const allowedHosts = new Set(options.allowedHosts || []);

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const parsed = new URL(url);

    if (allowedProtocols.has(parsed.protocol) || allowedHosts.has(parsed.hostname)) {
      await route.continue();
      return;
    }

    let frameUrl = '';
    try {
      frameUrl = request.frame()?.url() || '';
    } catch {
      frameUrl = 'service-worker-or-no-frame';
    }

    violations.push({
      method: request.method(),
      url,
      resourceType: request.resourceType(),
      frameUrl,
    });
    await route.abort('blockedbyclient');
  });

  return {
    violations,
    assertNoEscapes() {
      if (violations.length === 0) return;
      const details = violations
        .map(v => `${v.method} ${v.url} (${v.resourceType}) from ${v.frameUrl || 'no frame'}`)
        .join('\n');
      throw new Error(`Unexpected external network request(s):\n${details}`);
    },
  };
}
