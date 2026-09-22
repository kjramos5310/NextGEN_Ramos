import { Controller, Get, Header } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    // Estado del pool de pg en el momento del scrape (R3.5b): conexiones en uso y peticiones en espera
    const pool = (this.dataSource.driver as any)?.master;
    if (pool) {
      this.metricsService.setPoolStats(pool.totalCount - pool.idleCount, pool.waitingCount);
    }
    return this.metricsService.getMetrics();
  }
}
