import { Module } from '@nestjs/common';
import { LifecycleStateService } from './lifecycle-state.service.js';
import { ProbesController } from './probes.controller.js';

@Module({
  controllers: [ProbesController],
  providers: [LifecycleStateService],
  exports: [LifecycleStateService],
})
export class ProbesModule {}
