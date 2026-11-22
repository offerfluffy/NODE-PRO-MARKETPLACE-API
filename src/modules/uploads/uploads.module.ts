import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FilesRepository } from '../database/repositories/files.repository.js';
import { StorageService } from './services/storage.service.js';
import { UploadsService } from './services/uploads.service.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [UploadsController],
  providers: [
    {
      provide: FilesRepository,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => new FilesRepository(dataSource),
    },
    StorageService,
    UploadsService,
  ],
  exports: [StorageService, UploadsService],
})
export class UploadsModule {}
