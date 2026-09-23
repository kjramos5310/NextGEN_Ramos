import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Pico de quincena: hasta 10 000 transferencias por simulación (el orden de magnitud del reto).
 * La concurrencia se acota aparte: más workers que conexiones del pool solo generan espera.
 */
export class QuincenaSpikeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  totalRequests?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  concurrentWorkers?: number;
}
