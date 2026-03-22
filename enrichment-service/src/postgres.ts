import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool | null {
  const url = process.env.INTERNAL_DB_URL;
  if (!url) return null;
  if (!pool) {
    try {
      pool = new Pool({ connectionString: url });
    } catch {
      return null;
    }
  }
  return pool;
}

export interface UserInfo {
  email: string;
  plan?: string;
  signupDate?: string;
  flags?: Record<string, unknown>;
}

/**
 * Query internal Postgres for user account info.
 * Expects a users table with at least: email, and optionally plan, created_at, etc.
 * Adapt the query to match your schema.
 */
export async function fetchUserInfo(email: string): Promise<UserInfo | null> {
  const p = getPool();
  if (!p) return null;

  try {
    const res = await p.query(
      `SELECT email, plan, created_at as signup_date
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      email: row.email,
      plan: row.plan,
      signupDate: row.signup_date ? new Date(row.signup_date).toISOString().split("T")[0] : undefined,
      flags: {},
    };
  } catch {
    return null;
  }
}
