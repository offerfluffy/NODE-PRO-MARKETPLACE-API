import { AbstractLogger, type LogLevel, type LogMessage } from 'typeorm';

export class QueryCountLogger extends AbstractLogger {
  count = 0;
  echo = false;

  constructor() {
    super(['query']);
  }

  reset(): void {
    this.count = 0;
  }

  protected writeLog(
    _level: LogLevel,
    messages: LogMessage | LogMessage[],
  ): void {
    const entries = Array.isArray(messages) ? messages : [messages];

    for (const entry of entries) {
      if (entry.type !== 'query') {
        continue;
      }

      this.count += 1;

      if (this.echo) {
        console.log(`SQL #${this.count}: ${String(entry.message)}`);
      }
    }
  }
}

export const queryCountLogger = new QueryCountLogger();
