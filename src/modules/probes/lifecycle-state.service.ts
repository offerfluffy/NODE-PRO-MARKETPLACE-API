import { Injectable } from '@nestjs/common';
import { hostname } from 'node:os';

@Injectable()
export class LifecycleStateService {
  private ready = false;
  private readonly host = hostname();

  isReady(): boolean {
    return this.ready;
  }

  markReady(): void {
    this.ready = true;
  }

  markNotReady(): void {
    this.ready = false;
  }

  getInfo() {
    return {
      service: 'marketplace-api',
      rev: process.env.REV ?? 'local',
      ready: this.ready,
      hostname: this.host,
      pid: process.pid,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      uptimeSec: Math.round(process.uptime()),
    };
  }
}
