import { AIRecommendation } from '../types';

/** Etiqueta del motor real que generó la recomendación; "—" si el backend no lo informa. */
export const aiEngineLabel = (rec: Pick<AIRecommendation, 'metadata'>): string => {
  const engine = rec.metadata?.engine;
  // 'gemini-3.6-flash' -> 'Gemini 3.6 Flash' (el modelo se configura con GEMINI_MODEL)
  if (typeof engine === 'string' && engine.startsWith('gemini-')) {
    return engine.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  if (engine === 'heuristic-fallback') return 'Motor heurístico local';
  return typeof engine === 'string' && engine.length > 0 ? engine : '—';
};
