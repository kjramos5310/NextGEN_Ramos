import { AIRecommendation } from '../types';

/** Etiqueta del motor real que generó la recomendación; "—" si el backend no lo informa. */
export const aiEngineLabel = (rec: Pick<AIRecommendation, 'metadata'>): string => {
  const engine = rec.metadata?.engine;
  if (engine === 'gemini-2.5-flash') return 'Gemini 2.5 Flash';
  if (engine === 'heuristic-fallback') return 'Motor heurístico local';
  return typeof engine === 'string' && engine.length > 0 ? engine : '—';
};
