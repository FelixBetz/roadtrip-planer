import { neon } from '@neondatabase/serverless';
import { DATABASE_URL } from '$env/static/private';
import type { User, Trip, NewTrip, Stop, StopInput, RouteData, TripMember } from './types.js';

const sql = neon(DATABASE_URL);

// Reise inkl. Namen von Besitzer und letztem Bearbeiter
const TRIP_SELECT = `
    SELECT t.id, t.user_id, t.name, t.description, t.start_date, t.avoid_highways, t.avoid_tolls,
           t.created_at, t.version, t.stops_version, t.updated_by,
           ub.username AS updated_by_name, o.username AS owner_name
    FROM trips t
    JOIN users o ON o.id = t.user_id
    LEFT JOIN users ub ON ub.id = t.updated_by`;

/** Wird geworfen, wenn jemand anderes die Ortsliste inzwischen geändert hat. */
export class VersionConflictError extends Error {
    constructor() { super('version_conflict'); }
}

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

/** Eigene und mit dem Nutzer geteilte Reisen */
export async function getUserTrips(userId: number): Promise<Trip[]> {
    return await sql(
        `${TRIP_SELECT}
         WHERE t.user_id = $1
            OR EXISTS (SELECT 1 FROM trip_members m WHERE m.trip_id = t.id AND m.user_id = $1)
         ORDER BY t.created_at ASC`,
        [userId],
    ) as Trip[];
}

export async function getTrip(id: number): Promise<Trip | null> {
    const rows = await sql(`${TRIP_SELECT} WHERE t.id = $1`, [id]);
    return (rows[0] as Trip) ?? null;
}

export async function createTrip(data: NewTrip): Promise<Trip> {
    const rows = await sql`
        INSERT INTO trips (user_id, name, description, updated_by)
        VALUES (${data.user_id}, ${data.name}, ${data.description}, ${data.user_id})
        RETURNING id
    `;
    return (await getTrip((rows[0] as { id: number }).id))!;
}

export type TripUpdate = Partial<Pick<Trip, 'name' | 'description' | 'start_date' | 'avoid_highways' | 'avoid_tolls'>>;

/** Ändert nur die übergebenen Felder, damit sich zwei Bearbeiter nicht gegenseitig überschreiben. */
export async function updateTrip(id: number, data: TripUpdate, userId: number): Promise<Trip | null> {
    await sql(
        `UPDATE trips
         SET name           = COALESCE($2, name),
             description    = COALESCE($3, description),
             start_date     = COALESCE($4, start_date),
             avoid_highways = COALESCE($5, avoid_highways),
             avoid_tolls    = COALESCE($6, avoid_tolls),
             version        = version + 1,
             updated_by     = $7,
             updated_at     = NOW()::TEXT
         WHERE id = $1`,
        [id, data.name ?? null, data.description ?? null, data.start_date ?? null,
         data.avoid_highways ?? null, data.avoid_tolls ?? null, userId],
    );
    return getTrip(id);
}

export async function deleteTrip(id: number): Promise<boolean> {
    const result = await sql`DELETE FROM trips WHERE id = ${id}`;
    return (result as unknown as { rowCount: number }).rowCount > 0;
}

// -- Mitglieder (gemeinsames Bearbeiten) ------------------------------

export async function isTripMember(tripId: number, userId: number): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM trip_members WHERE trip_id = ${tripId} AND user_id = ${userId}`;
    return rows.length > 0;
}

/** Besitzer zuerst, dann die Mitglieder in der Reihenfolge, in der sie hinzugefügt wurden */
export async function getTripMembers(tripId: number): Promise<TripMember[]> {
    return await sql`
        SELECT u.id AS user_id, u.username, TRUE AS is_owner
        FROM trips t JOIN users u ON u.id = t.user_id
        WHERE t.id = ${tripId}
        UNION ALL
        SELECT * FROM (
            SELECT u.id AS user_id, u.username, FALSE AS is_owner
            FROM trip_members m JOIN users u ON u.id = m.user_id
            WHERE m.trip_id = ${tripId}
            ORDER BY m.added_at ASC
        ) members
    ` as TripMember[];
}

export async function addTripMember(tripId: number, userId: number): Promise<void> {
    await sql`
        INSERT INTO trip_members (trip_id, user_id) VALUES (${tripId}, ${userId})
        ON CONFLICT DO NOTHING
    `;
}

export async function removeTripMember(tripId: number, userId: number): Promise<void> {
    await sql`DELETE FROM trip_members WHERE trip_id = ${tripId} AND user_id = ${userId}`;
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

/**
 * Speichert die Ortsliste (Reihenfolge = Array-Reihenfolge). Bestehende Orte behalten ihre id
 * und ihre Texte, es werden nur Position und Koordinaten übernommen. Texte ändert updateStop,
 * so gehen Notizen nicht verloren, wenn gleichzeitig jemand die Route umbaut.
 *
 * baseVersion ist die stops_version, auf der der Bearbeiter aufgebaut hat. Hat inzwischen
 * jemand anderes die Liste geändert, wird nichts gespeichert (VersionConflictError).
 */
export async function replaceStops(tripId: number, baseVersion: number, stops: StopInput[], userId: number): Promise<void> {
    const keep = stops.map((s) => s.id).filter((id): id is number => typeof id === 'number');
    try {
        await sql.transaction([
            // Erst die Version hochzählen (sperrt die Zeile). Passt die Basis nicht, bricht der
            // ungültige Cast die ganze Transaktion ab.
            sql`
                UPDATE trips
                SET stops_version = CASE WHEN stops_version = ${baseVersion} THEN stops_version + 1
                                         ELSE ('version_conflict:' || stops_version)::INTEGER END,
                    version       = version + 1,
                    updated_by    = ${userId},
                    updated_at    = NOW()::TEXT
                WHERE id = ${tripId}
            `,
            sql`DELETE FROM trip_stops WHERE trip_id = ${tripId} AND NOT (id = ANY(${keep}::INTEGER[]))`,
            ...stops.map((s, i) => typeof s.id === 'number'
                ? sql`
                    UPDATE trip_stops SET position = ${i + 1}, lat = ${s.lat}, lon = ${s.lon}
                    WHERE id = ${s.id} AND trip_id = ${tripId}
                `
                : sql`
                    INSERT INTO trip_stops (trip_id, position, kind, name, lat, lon, notes, rest_days, rest_notes, visit_minutes)
                    VALUES (${tripId}, ${i + 1}, ${s.kind}, ${s.name}, ${s.lat}, ${s.lon}, ${s.notes},
                            ${s.rest_days}, ${s.rest_notes}, ${s.visit_minutes})
                `),
        ]);
    } catch (e) {
        if (String((e as Error)?.message).includes('version_conflict')) throw new VersionConflictError();
        throw e;
    }
}

export type StopUpdate = Partial<Pick<Stop, 'name' | 'notes' | 'kind' | 'rest_days' | 'rest_notes' | 'visit_minutes'>>;

/** Ändert nur die übergebenen Felder eines Orts. null = Ort gibt es nicht (mehr). */
export async function updateStop(tripId: number, id: number, data: StopUpdate, userId: number): Promise<Stop | null> {
    const [rows] = await sql.transaction([
        sql`
            UPDATE trip_stops
            SET name          = COALESCE(${data.name ?? null}, name),
                notes         = COALESCE(${data.notes ?? null}, notes),
                kind          = COALESCE(${data.kind ?? null}, kind),
                rest_days     = COALESCE(${data.rest_days ?? null}::INTEGER, rest_days),
                rest_notes    = COALESCE(${data.rest_notes ?? null}, rest_notes),
                visit_minutes = COALESCE(${data.visit_minutes ?? null}::INTEGER, visit_minutes)
            WHERE id = ${id} AND trip_id = ${tripId}
            RETURNING *
        `,
        sql`
            UPDATE trips
            SET version = version + 1, updated_by = ${userId}, updated_at = NOW()::TEXT
            WHERE id = ${tripId} AND EXISTS (SELECT 1 FROM trip_stops WHERE id = ${id} AND trip_id = ${tripId})
        `,
    ]);
    const s = (rows as Stop[])[0];
    return s ? { ...s, lat: Number(s.lat), lon: Number(s.lon) } : null;
}
