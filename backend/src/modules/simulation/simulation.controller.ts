import { Controller, Post, Get, Body } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import { QuincenaSpikeDto } from './dto/quincena-spike.dto';

/** Solo se registra con SIMULATION_ENABLED=true (ver AppModule): mueve saldos reales. */
@Controller('api/v1/simulation')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post('quincena-spike')
  async runQuincenaSpike(@Body() body: QuincenaSpikeDto) {
    return this.simulationService.runQuincenaSpike(body);
  }

  @Get('db-diagnostics')
  async getDbDiagnostics() {
    return this.simulationService.getDatabaseDiagnostics();
  }
}
