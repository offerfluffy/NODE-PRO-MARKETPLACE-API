import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { LifecycleStateService } from './lifecycle-state.service.js';

@Controller()
export class ProbesController {
  constructor(private readonly lifecycle: LifecycleStateService) {}

  @Get('healthz')
  liveness() {
    return {
      status: 'alive',
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
    };
  }

  @Get('readyz')
  readiness() {
    if (!this.lifecycle.isReady()) {
      throw new ServiceUnavailableException({
        status: 'not-ready',
        rev: process.env.REV ?? 'local',
      });
    }
    return {
      status: 'ready',
      rev: process.env.REV ?? 'local',
    };
  }

  @Get()
  root() {
    return this.lifecycle.getInfo();
  }
}
