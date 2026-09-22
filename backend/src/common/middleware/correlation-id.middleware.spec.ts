import { normalizeCorrelationId } from './correlation-id.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('normalizeCorrelationId', () => {
  it('conserva un id válido del cliente', () => {
    expect(normalizeCorrelationId('FRONT-123_abc:1.2')).toBe('FRONT-123_abc:1.2');
  });

  it.each([undefined, '', '   ', 'x'.repeat(65), 'con espacios', 'inyección\nlog', ['a b']])(
    'regenera un UUID si es inválido: %j',
    (raw) => {
      expect(normalizeCorrelationId(raw)).toMatch(UUID);
    },
  );
});
