import pg from 'pg';
import { StandalonePromotionCoordinator } from '../../../services/rdf-sync/src/standalone-promotion-coordinator.js';

const databaseUrl = process.env.JWB_ROUTER_DATABASE_URL;
const action = process.argv[2];
const crashAt = process.env.JWB_PROMOTION_CRASH_AT || null;
if (!/^postgres(?:ql)?:\/\/[^@/]+:[^@/]+@jwb-postgresql:5432\/japan_wikibase_query$/u.test(databaseUrl ?? ''))
  throw new Error('FIXED_STANDALONE_POSTGRES_REQUIRED');
if (!['promote', 'rollback', 'status'].includes(action) || process.argv.length !== 3)
  throw new Error('FIXED_STANDALONE_LIFECYCLE_ACTION_REQUIRED');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const coordinator = new StandalonePromotionCoordinator({ pool, routerObserver: observeRouter });
try {
  const result = action === 'status' ? await coordinator.status()
    : await coordinator.promote({ mode: action === 'promote' ? 'PROMOTE' : 'ROLLBACK', crashAt });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally { await pool.end(); }

async function observeRouter({ generationId, version }) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:19200/sparql', { method: 'POST', headers: {
        'content-type': 'application/sparql-query', accept: 'application/sparql-results+json',
      }, body: 'ASK { ?s ?p ?o }' });
      if (response.ok && response.headers.get('x-jwb-pointer-version') === String(version)) {
        const runtime = await fetch('http://127.0.0.1:19200/runtime');
        if (runtime.ok && (await runtime.json()).queryService?.servingGeneration === generationId) return true;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}
