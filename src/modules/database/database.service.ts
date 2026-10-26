import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

type ConnectionCheck = {
  current_user: string;
  now: string;
};

@Injectable()
export class DatabaseService {
  constructor(private readonly dataSource: DataSource) {}

  async checkConnection(): Promise<ConnectionCheck | undefined> {
    const rows = await this.dataSource.query<ConnectionCheck[]>(
      'SELECT current_user, now()::text AS now',
    );

    return rows[0];
  }
}
