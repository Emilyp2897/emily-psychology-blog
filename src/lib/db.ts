import { createPool } from '@vercel/postgres';

// Astro 5 exposes .env values via import.meta.env at server runtime, but
// does NOT always copy them into process.env. The @vercel/postgres `sql`
// tagged template reads from process.env.POSTGRES_URL by default, which
// fails locally with "missing_connection_string". Initialising the pool
// explicitly from import.meta.env bypasses that whole problem.

const connectionString =
  import.meta.env.POSTGRES_URL ||
  import.meta.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  throw new Error(
    'POSTGRES_URL is not set. Add it to your .env (locally) or to your Vercel project environment variables.'
  );
}

const pool = createPool({ connectionString });

// Re-export `sql` bound to this explicit pool so existing call sites can
// keep using the tagged-template syntax unchanged.
export const sql = pool.sql.bind(pool);
