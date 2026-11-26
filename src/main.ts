import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.schema.js';
import { LifecycleStateService } from './modules/probes/lifecycle-state.service.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got: "${raw}"`);
  }
  return value;
}

async function bootstrap() {
  const standalone = process.env.K8S_STANDALONE === '1';
  const warmupMs = readNonNegativeInt('WARMUP_MS', 0);
  const drainMs = readNonNegativeInt('DRAIN_MS', 0);
  const graceful = process.env.GRACEFUL_SHUTDOWN !== '0';

  const app = standalone
    ? await NestFactory.create((await import('./k8s-app.module.js')).K8sAppModule)
    : await NestFactory.create((await import('./app.module.js')).AppModule);

  const lifecycle = app.get(LifecycleStateService);
  const port = standalone
    ? readNonNegativeInt('PORT', 3000)
    : app.get(ConfigService<Env, true>).get('PORT', { infer: true });

  if (warmupMs > 0) {
    console.log(`[warmup] waiting ${warmupMs}ms before listen`);
    await sleep(warmupMs);
  }

  await app.listen(port, '0.0.0.0');
  lifecycle.markReady();
  console.log(`[ready] listening on 0.0.0.0:${port} (rev=${process.env.REV ?? 'local'})`);

  let shuttingDown = false;
  const handleSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (!graceful) {
      console.log(`[shutdown] ${signal} received (graceful=0), exiting immediately`);
      process.exit(0);
    }

    console.log(`[shutdown] ${signal} received: ready=false, draining for ${drainMs}ms`);
    lifecycle.markNotReady();

    const forceTimer = setTimeout(() => {
      console.error('[shutdown] drain timeout exceeded, forcing exit(1)');
      process.exit(1);
    }, drainMs + 10_000);
    forceTimer.unref();

    void (async () => {
      try {
        if (drainMs > 0) {
          await sleep(drainMs);
        }
        await app.close();
        process.exit(0);
      } catch (error) {
        console.error('[shutdown] error during app.close():', error);
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
}

void bootstrap();
