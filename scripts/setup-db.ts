/**
 * Run once to create all tables in your Neon Postgres database.
 * Usage: npm run setup-db
 * Requires DATABASE_URL in .env
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually (tsx doesn't load it automatically)
try {
    const env = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
    for (const line of env.split('\n')) {
        const match = line.match(/^([^#=\s][^=]*)=(.+)$/);
        if (match) process.env[match[1].trim()] = match[2].trim();
    }
} catch {
    // .env not found – rely on environment variables already set
}

const url = process.env.DATABASE_URL;
if (!url) {
    console.error('DATABASE_URL is not set. Add it to .env or set it as an environment variable.');
    process.exit(1);
}

const sql = neon(url);

// users + auth_sessions sind identisch zum Routenplaner, d.h. beide Apps
// können sich bei Bedarf dieselbe Datenbank (und dieselben Logins) teilen.
await sql`
    CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT   NOT NULL UNIQUE,
        password_hash TEXT   NOT NULL,
        created_at    TEXT   NOT NULL DEFAULT (NOW()::TEXT)
    )
`;

await sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
        token      TEXT    PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT    NOT NULL
    )
`;

await sql`
    CREATE TABLE IF NOT EXISTS trips (
        id             SERIAL  PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name           TEXT    NOT NULL,
        description    TEXT    NOT NULL DEFAULT '',
        start_date     TEXT    NOT NULL DEFAULT '',
        avoid_highways INTEGER NOT NULL DEFAULT 0,
        avoid_tolls    INTEGER NOT NULL DEFAULT 0,
        route_data     TEXT    DEFAULT NULL,
        created_at     TEXT    NOT NULL DEFAULT (NOW()::TEXT)
    )
`;

await sql`
    CREATE TABLE IF NOT EXISTS trip_stops (
        id            SERIAL  PRIMARY KEY,
        trip_id       INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        position      INTEGER NOT NULL,
        kind          TEXT    NOT NULL DEFAULT 'stage',
        name          TEXT    NOT NULL DEFAULT '',
        lat           DOUBLE PRECISION NOT NULL,
        lon           DOUBLE PRECISION NOT NULL,
        notes         TEXT    NOT NULL DEFAULT '',
        rest_days     INTEGER NOT NULL DEFAULT 0,
        rest_notes    TEXT    NOT NULL DEFAULT '',
        visit_minutes INTEGER NOT NULL DEFAULT 0
    )
`;

console.log('Database schema created successfully.');
