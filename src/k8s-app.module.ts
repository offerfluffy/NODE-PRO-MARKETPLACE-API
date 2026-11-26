import { Module, OnModuleInit } from '@nestjs/common';
import { ProbesModule } from './modules/probes/probes.module.js';

@Module({
  imports: [ProbesModule],
})
export class K8sAppModule implements OnModuleInit {
  onModuleInit(): void {
    const dbPassword = process.env.APP_DB_PASSWORD?.trim();
    if (!dbPassword) {
      throw new Error(
        'Missing required runtime secret APP_DB_PASSWORD (expected from Kubernetes Secret).',
      );
    }
  }
}
