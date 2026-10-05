import { neon } from '@neondatabase/serverless';
import { DATABASE_URL } from '$env/static/private';
import type { User, Trip, NewTrip, Stop, NewStop, RouteData } from './types.js';

const sql = neon(DATABASE_URL);

const TRIP_COLS = 'id, user_id, name, description, start_date, avoid_highways, avoid_tolls, created_at';

// -- Users ---------------------------------------------------------

export async function createUser(username: string, passwordHash: string): Promise<User> {
    const rows = await sql`
        INSERT INTO users (username, password_hash)
        VALUES (${username}, ${passwordHash})
        RETURNING id, username, created_at
    `;
    return rows[0] as User;
}

export async function getUserByUsername(username: string): Promise<(User & { password_hash: string }) | null> {
    const rows = await sql`
        SELECT id, username, password_hash, created_at FROM users WHERE username = ${username}
    `;
    return (rows[0] as (User & { password_hash: string })) ?? null;
}

export async function getUserById(id: number): Promise<User | null> {
    const rows = await sql`
        SELECT id, username, created_at FROM users WHERE id = ${id}
    `;
    return (rows[0] as User) ?? null;
}

// -- Auth Sessions -------------------------------------------------

export async function createAuthSession(token: string, userId: number, expiresAt: string): Promise<void> {
    await sql`
        INSERT INTO auth_sessions (token, user_id, expires_at)
        VALUES (${token}, ${userId}, ${expiresAt})
    `;
}

export async function getAuthSession(token: string): Promise<{ user_id: number; expires_at: string } | null> {
    const rows = await sql`
        SELECT user_id, expires_at FROM auth_sessions WHERE token = ${token}
    `;
    return (rows[0] as { user_id: number; expires_at: string }) ?? null;
}

export async function deleteAuthSession(token: string): Promise<void> {
    await sql`DELETE FROM auth_sessions WHERE token = ${token}`;
}

export async function deleteExpiredAuthSessions(): Promise<void> {
    await sql`DELETE FROM auth_sessions WHERE expires_at::timestamptz < NOW()`;
}

// -- Trips ---------------------------------------------------------

export async function getUserTrips(userId: number): Promise<Trip[]> {
    return await sql(
        `SELECT ${TRIP_COLS} FROM trips WHERE user_id = $1 ORDER BY created_at ASC`,
        [userId],
    ) as Trip[];
}

export async function getTrip(id: number): Promise<Trip | null> {
    const rows = await sql(`SELECT ${TRIP_COLS} FROM trips WHERE id = $1`, [id]);
    return (rows[0] as Trip) ?? null;
}

export async function createTrip(data: NewTrip): Promise<Trip> {
    const rows = await sql(
        `INSERT INTO trips (user_id, name, description) VALUES ($1, $2, $3) RETURNING ${TRIP_COLS}`,
        [data.user_id, data.name, data.description],
    );
    return rows[0] as Trip;
}

export type TripUpdate = Partial<Pick<Trip, 'name' | 'description' | 'start_date' | 'avoid_highways' | 'avoid_tolls'>>;

export async function updateTrip(id: number, data: TripUpdate): Promise<Trip | null> {
    const cur = await getTrip(id);
    if (!cur) return null;
    const next = { ...cur, ...data };
    const rows = await sql(
        `UPDATE trips
         SET name = $2, description = $3, start_date = $4, avoid_highways = $5, avoid_tolls = $6
         WHERE id = $1
         RETURNING ${TRIP_COLS}`,
        [id, next.name, next.description, next.start_date, next.avoid_highways, next.avoid_tolls],
    );
    return (rows[0] as Trip) ?? null;
}

export async function deleteTrip(id: number): Promise<boolean> {
    const result = await sql`DELETE FROM trips WHERE id = ${id}`;
    return (result as unknown as { rowCount: number }).rowCount > 0;
}

// -- Route (Cache der berechneten Strecke) ------------------------

export async function getTripRoute(tripId: number): Promise<RouteData | null> {
    const rows = await sql`SELECT route_data FROM trips WHERE id = ${tripId}`;
    const row = rows[0] as { route_data: string | null } | undefined;
    if (!row || !row.route_data) return null;
    try { return JSON.parse(row.route_data) as RouteData; } catch { return null; }
}

export async function setTripRoute(tripId: number, data: RouteData | null): Promise<void> {
    await sql`UPDATE trips SET route_data = ${data ? JSON.stringify(data) : null} WHERE id = ${tripId}`;
}

// -- Stops ---------------------------------------------------------

export async function getAllStops(tripId: number): Promise<Stop[]> {
    const rows = await sql`
        SELECT * FROM trip_stops WHERE trip_id = ${tripId} ORDER BY position ASC
    ` as Stop[];
    // DOUBLE PRECISION kommt als number, INTEGER ebenfalls — nur zur Sicherheit normalisieren
    return rows.map((s) => ({ ...s, lat: Number(s.lat), lon: Number(s.lon) }));
}

/** Ersetzt alle Stopps einer Reise in einer Transaktion (neue Reihenfolge = Array-Reihenfolge). */
export async function replaceStops(tripId: number, stops: NewStop[]): Promise<Stop[]> {
    await sql.transaction([
        sql`DELETE FROM trip_stops WHERE trip_id = ${tripId}`,
        ...stops.map((s, i) => sql`
            INSERT INTO trip_stops (trip_id, position, kind, name, lat, lon, notes, rest_days, rest_notes, visit_minutes)
            VALUES (${tripId}, ${i + 1}, ${s.kind}, ${s.name}, ${s.lat}, ${s.lon}, ${s.notes},
                    ${s.rest_days}, ${s.rest_notes}, ${s.visit_minutes})
        `),
    ]);
    return getAllStops(tripId);
}

export type StopUpdate = Partial<Pick<Stop, 'name' | 'notes' | 'kind' | 'rest_days' | 'rest_notes' | 'visit_minutes'>>;

export async function updateStop(tripId: number, id: number, data: StopUpdate): Promise<Stop | null> {
    const current = await sql`SELECT * FROM trip_stops WHERE id = ${id} AND trip_id = ${tripId}`;
    if (!current[0]) return null;
    const cur = current[0] as Stop;
    const rows = await sql`
        UPDATE trip_stops
        SET name          = ${data.name ?? cur.name},
            notes         = ${data.notes ?? cur.notes},
            kind          = ${data.kind ?? cur.kind},
            rest_days     = ${data.rest_days ?? cur.rest_days},
            rest_notes    = ${data.rest_notes ?? cur.rest_notes},
            visit_minutes = ${data.visit_minutes ?? cur.visit_minutes}
        WHERE id = ${id} AND trip_id = ${tripId}
        RETURNING *
    `;
    const s = rows[0] as Stop | undefined;
    return s ? { ...s, lat: Number(s.lat), lon: Number(s.lon) } : null;
}
