import { AI_LIMITS, RepairContextSchema } from '@/lib/schemas';
import { AiError, getMetaConfig, proposeRepairs, readLimited } from '@/lib/ai/meta';
export const runtime = 'nodejs';
// Leave time for the provider's 45-second timeout to return a readable error.
export const maxDuration = 60;
const headers = { 'Cache-Control': 'no-store' };
export async function GET() {
  try { const { model } = getMetaConfig(); return Response.json({ configured: true, model }, { headers }); }
  catch { return Response.json({ configured: false }, { headers }); }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    // Next may normalize request.url to localhost while the browser uses 127.0.0.1.
    // Compare against the incoming Host header, not Next's internal URL hostname.
    const host = request.headers.get('host') ?? new URL(request.url).host;
    if (origin) {
      let originUrl: URL;
      try { originUrl = new URL(origin); } catch { throw new AiError('Invalid request origin.', 403); }
      if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.host !== host) throw new AiError('Cross-origin requests are not allowed.', 403);
    }
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AiError('Expected a JSON request.', 415);
    if (Number(request.headers.get('content-length')) > AI_LIMITS.requestBytes) throw new AiError('Request is too large.', 413);
    let input: unknown;
    try { input = JSON.parse(await readLimited(request.body, AI_LIMITS.requestBytes)); }
    catch (error) { if (error instanceof AiError) throw error; throw new AiError('Invalid JSON request.', 400); }
    const result = RepairContextSchema.safeParse(input);
    if (!result.success) throw new AiError('Invalid column context. Choose 2–100 distinct nonempty category values, each up to 200 characters.', 400);
    return Response.json(await proposeRepairs(result.data, request.signal), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof AiError ? error.message : 'Analysis failed. Nothing changed.' }, { status: error instanceof AiError ? error.status : 500, headers });
  }
}
