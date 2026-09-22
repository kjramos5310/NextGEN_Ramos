import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Tope explícito: una sola petición no puede lanzar miles de transferencias contra el pool. */
export class QuincenaSpikeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  totalRequests?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  concurrentWorkers?: number;
}
