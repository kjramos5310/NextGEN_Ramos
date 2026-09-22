import { Controller, Post, Get, Body } from '@nestjs/common';
import { SimulationService } from './simulation.service';

@Controller('api/v1/simulation')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post('quincena-spike')
  async runQuincenaSpike(@Body() body: { totalRequests?: number; concurrentWorkers?: number }) {
    return this.simulationService.runQuincenaSpike(body);
  }

  @Get('db-diagnostics')
  async getDbDiagnostics() {
    return this.simulationService.getDatabaseDiagnostics();
  }
}
