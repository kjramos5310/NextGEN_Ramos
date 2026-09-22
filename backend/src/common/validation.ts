import { ValidationPipe } from '@nestjs/common';

/** ValidationPipe global (main.ts). Se exporta para probar los DTOs con la misma configuración. */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  });
}
