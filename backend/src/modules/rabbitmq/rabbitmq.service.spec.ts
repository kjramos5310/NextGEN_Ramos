import { RabbitMQService } from './rabbitmq.service';

const logger: any = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
const config: any = { get: (k: string, d: any) => (k === 'RABBITMQ_CONFIRM_TIMEOUT_MS' ? 50 : d) };

/** Servicio con un canal de confirmación simulado: cb(err) emula el nack/ack del broker. */
function withChannel(publish: jest.Mock) {
  const service = new RabbitMQService(config, logger);
  (service as any).channel = { publish };
  (service as any).isConnected = true;
  return service;
}

describe('RabbitMQService - publisher confirms', () => {
  it('ack del broker -> true', async () => {
    const publish = jest.fn((_ex, _rk, _buf, _opts, cb) => setImmediate(() => cb(null)));
    await expect(withChannel(publish).publishEvent('transaction.created', { eventId: 'e1' })).resolves.toBe(true);
    expect(publish.mock.calls[0][3]).toEqual(expect.objectContaining({ persistent: true, messageId: 'e1' }));
  });

  it('nack del broker -> false', async () => {
    const publish = jest.fn((_ex, _rk, _buf, _opts, cb) => setImmediate(() => cb(new Error('nack'))));
    await expect(withChannel(publish).publishEvent('transaction.created', { eventId: 'e2' })).resolves.toBe(false);
  });

  it('sin confirmación dentro del timeout -> false', async () => {
    const publish = jest.fn(); // nunca llama al callback
    await expect(withChannel(publish).publishEvent('bancs.sync', { eventId: 'e3' })).resolves.toBe(false);
  });

  it('excepción al publicar (canal cerrado) -> false', async () => {
    const publish = jest.fn(() => {
      throw new Error('Channel closed');
    });
    await expect(withChannel(publish).publishEvent('bancs.sync', { eventId: 'e4' })).resolves.toBe(false);
  });

  it('sin conexión -> false sin intentar publicar', async () => {
    const service = new RabbitMQService(config, logger);
    await expect(service.publishEvent('bancs.sync', {})).resolves.toBe(false);
  });
});
