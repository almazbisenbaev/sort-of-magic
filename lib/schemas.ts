import { z } from 'zod';
export const AI_LIMITS = { values: 100, valueLength: 200, requestBytes: 32_000, responseBytes: 128_000 };
const value = z.string().min(1).max(AI_LIMITS.valueLength).refine(v => v.trim().length > 0);
export const RepairContextSchema = z.object({
  guidance: z.string().max(1000).optional(),
  columnName: z.string().min(1).max(200),
  values: z.array(z.object({ value, count: z.number().int().min(1).max(5000) }).strict()).min(2).max(AI_LIMITS.values),
}).strict().refine(ctx => new Set(ctx.values.map(v => v.value)).size === ctx.values.length, 'Values must be distinct');
export const SuggestionsSchema = z.object({
  mappings: z.array(z.object({ from: value, to: value, reason: z.string().min(1).max(600) }).strict()).max(100),
  ambiguities: z.array(z.object({ values: z.array(value).min(1).max(100), reason: z.string().min(1).max(600) }).strict()).max(100),
}).strict();
export type RepairContext = z.infer<typeof RepairContextSchema>;
export type Suggestions = z.infer<typeof SuggestionsSchema>;
export const AiResponseSchema = z.object({ suggestions: SuggestionsSchema, model: z.string().min(1).max(200) }).strict();

export function validateSuggestions(raw: unknown, context: RepairContext): Suggestions {
  const suggestions = SuggestionsSchema.parse(raw);
  const known = new Set(context.values.map(v => v.value));
  const sources = new Set<string>();
  const uncertain = new Set(suggestions.ambiguities.flatMap(a => a.values));
  for (const v of uncertain) if (!known.has(v)) throw new Error('AI referenced an unknown ambiguous value.');
  for (const m of suggestions.mappings) {
    if (!known.has(m.from) || !known.has(m.to)) throw new Error('AI referenced a value outside this column.');
    if (m.from === m.to || sources.has(m.from)) throw new Error('AI returned redundant or conflicting mappings.');
    if (uncertain.has(m.from) || uncertain.has(m.to)) throw new Error('AI proposed a change involving an unresolved ambiguity.');
    sources.add(m.from);
  }
  if (suggestions.mappings.some(m => sources.has(m.to))) throw new Error('AI returned chained or circular mappings.');
  return suggestions;
}
