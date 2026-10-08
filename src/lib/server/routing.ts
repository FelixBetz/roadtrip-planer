/**
 * Auto-Routing + Geocoding.
 *
 * Mit ORS_API_KEY  → OpenRouteService (Autobahn/Maut meiden zuverlässig, max. 50 Punkte)
 * Ohne Key         → öffentlicher OSRM-Demo-Server + Photon (nur zum Ausprobieren)
 */
import { env } from '$env/dynamic/private';
import type { GeocodeResult, RouteData, RouteLeg, TollSection } from '$lib/types.js';

export interface RoutePoint { lat: number; lon: number }
export interface RouteOptions { avoidHighways: boolean; avoidTolls: boolean }

const ORS = 'https://api.openrouteservice.org';
const OSRM = 'https://router.project-osrm.org';
const PHOTON = 'https://photon.komoot.io';
const USER_AGENT = 'roadtrip-planer (private Reiseplanung)';

export class RoutingError extends Error {}

function orsKey(): string | null {
    const k = env.ORS_API_KEY?.trim();
    return k ? k : null;
}

/** Fingerabdruck, um zu erkennen, ob die gespeicherte Route noch zu den Stopps passt. */
export function routeKey(points: RoutePoint[], opts: RouteOptions): string {
    const p = points.map((s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`).join(';');
    // „v5“: seit Mautabschnitte mit Land und Etappe mitgespeichert werden (v7: mit Position je Abschnitt) – ältere Routen neu berechnen
    return `${p}|h${opts.avoidHighways ? 1 : 0}t${opts.avoidTolls ? 1 : 0}|${orsKey() ? 'ors' : 'osrm'}|v7`;
}

// -- Routing -------------------------------------------------------

export async function computeRoute(points: RoutePoint[], opts: RouteOptions): Promise<RouteData> {
    if (points.length < 2) throw new RoutingError('Mindestens zwei Orte nötig.');
    const key = orsKey();
    const result = key ? await routeOrs(points, opts, key) : await routeOsrm(points, opts);
    return { ...result, key: routeKey(points, opts) };
}

async function routeOrs(points: RoutePoint[], opts: RouteOptions, key: string): Promise<Omit<RouteData, 'key'>> {
    if (points.length > 50) throw new RoutingError('OpenRouteService erlaubt maximal 50 Punkte pro Route.');
    const avoid: string[] = [];
    if (opts.avoidHighways) avoid.push('highways');
    if (opts.avoidTolls) avoid.push('tollways');

    const body: Record<string, unknown> = {
        coordinates: points.map((p) => [p.lon, p.lat]),
        // Ohne Anweisungen liefert ORS keine „segments“ (km/Zeit pro Abschnitt) – daher an lassen
        instructions: true,
        // Liefert, welche Teile der Strecke mautpflichtig sind
        extra_info: ['tollways'],
        // -1 = Punkt beliebig weit zur nächsten Straße snappen (Default 350 m schlägt bei Orten oft fehl)
        radiuses: points.map(() => -1),
    };
    if (avoid.length) body.options = { avoid_features: avoid };

    const res = await fetch(`${ORS}/v2/directions/driving-car/geojson`, {
        method: 'POST',
        headers: {
            Authorization: key,
            'Content-Type': 'application/json',
            Accept: 'application/geo+json, application/json',
        },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null) as any;
    if (!res.ok) {
        const msg = json?.error?.message ?? json?.error ?? res.statusText;
        throw new RoutingError(`OpenRouteService: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    }
    const feature = json?.features?.[0];
    const coords: [number, number][] = (feature?.geometry?.coordinates ?? []).map(
        (c: number[]) => [c[1], c[0]] as [number, number],
    );
    const segments: { distance?: number; duration?: number }[] = feature?.properties?.segments ?? [];
    const wayPoints: number[] = feature?.properties?.way_points ?? [];
    if (!coords.length || wayPoints.length !== points.length) {
        console.error('Unerwartete ORS-Antwort:', JSON.stringify(json)?.slice(0, 1000));
        throw new RoutingError(
            `OpenRouteService: unerwartete Antwort (${points.length} Orte, ${wayPoints.length} Wegpunkte, ${coords.length} Koordinaten).`,
        );
    }

    const legCoords = wayPoints.slice(0, -1).map((w, i) => coords.slice(w, wayPoints[i + 1] + 1));
    let legs: RouteLeg[];
    if (segments.length === points.length - 1) {
        legs = segments.map((seg, i) => ({
            coords: simplify(legCoords[i]),
            distance: seg.distance ?? 0,
            duration: seg.duration ?? 0,
        }));
    } else {
        // Ohne Abschnittswerte: km aus der Geometrie, Fahrzeit anteilig aus der Gesamtzeit
        const lengths = legCoords.map(pathLength);
        const total = lengths.reduce((a, b) => a + b, 0) || 1;
        const summary = feature?.properties?.summary ?? {};
        const totalDistance = summary.distance ?? total;
        const totalDuration = summary.duration ?? 0;
        legs = legCoords.map((c, i) => ({
            coords: simplify(c),
            distance: (lengths[i] / total) * totalDistance,
            duration: (lengths[i] / total) * totalDuration,
        }));
    }
    return { ...finish('ors', legs), tolls: await tollSections(coords, feature?.properties?.extras?.tollways?.values, wayPoints, key) };
}

async function routeOsrm(points: RoutePoint[], opts: RouteOptions): Promise<Omit<RouteData, 'key'>> {
    const coordStr = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const exclude: string[] = [];
    if (opts.avoidHighways) exclude.push('motorway');
    if (opts.avoidTolls) exclude.push('toll');

    const fetchOsrm = async (ex: string[]) => {
        const qs = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'false' });
        if (ex.length) qs.set('exclude', ex.join(','));
        const res = await fetch(`${OSRM}/route/v1/driving/${coordStr}?${qs}`, {
            headers: { 'User-Agent': USER_AGENT },
        });
        return { ok: res.ok, json: await res.json().catch(() => null) as any };
    };

    let warning: string | undefined;
    let { ok, json } = await fetchOsrm(exclude);
    if ((!ok || json?.code !== 'Ok') && exclude.length) {
        // Der Demo-Server kennt nicht jede Kombination → ohne Ausschlüsse erneut versuchen
        ({ ok, json } = await fetchOsrm([]));
        warning = 'Autobahn/Maut meiden wird ohne ORS_API_KEY nicht unterstützt – Route ohne Einschränkung berechnet.';
    }
    if (!ok || json?.code !== 'Ok') {
        throw new RoutingError(`OSRM: ${json?.message ?? 'Route konnte nicht berechnet werden.'}`);
    }

    const route = json.routes[0];
    const coords: [number, number][] = route.geometry.coordinates.map(
        (c: number[]) => [c[1], c[0]] as [number, number],
    );
    const snapped: [number, number][] = json.waypoints.map(
        (w: { location: number[] }) => [w.location[1], w.location[0]] as [number, number],
    );

    // Gesamtgeometrie an den (gesnappten) Wegpunkten in Abschnitte aufteilen
    const cut: number[] = [0];
    let from = 0;
    for (let i = 1; i < snapped.length - 1; i++) {
        let best = from, bestD = Infinity;
        for (let j = from; j < coords.length; j++) {
            const d = sqDist(coords[j], snapped[i]);
            if (d < bestD) { bestD = d; best = j; }
            if (d === 0) break;
        }
        cut.push(best);
        from = best;
    }
    cut.push(coords.length - 1);

    const legs: RouteLeg[] = route.legs.map((leg: { distance: number; duration: number }, i: number) => ({
        coords: simplify(coords.slice(cut[i], cut[i + 1] + 1)),
        distance: leg.distance,
        duration: leg.duration,
    }));
    return { ...finish('osrm', legs), warning };
}

function finish(provider: 'ors' | 'osrm', legs: RouteLeg[]): Omit<RouteData, 'key'> {
    return {
        provider,
        legs,
        distance: legs.reduce((a, l) => a + l.distance, 0),
        duration: legs.reduce((a, l) => a + l.duration, 0),
    };
}

/** Lücken bis zu dieser Länge (Mautstation, Brücke …) zählen noch zum selben Mautabschnitt */
const TOLL_GAP_M = 5000;

/**
 * ORS liefert Maut als [vonIndex, bisIndex, wert] über die Gesamtgeometrie (wert 1 = mautpflichtig).
 * Daraus werden Linienzüge zum Einzeichnen, die Maut-km und – für die Kostenschätzung –
 * zusammenhängende Abschnitte mit ihrem Land.
 */
async function tollSections(
    coords: [number, number][], values: unknown, wayPoints: number[], key: string,
): Promise<RouteData['tolls']> {
    if (!Array.isArray(values)) return undefined;
    const lines: [number, number][][] = [];
    const ranges: [number, number][] = [];
    for (const v of values) {
        if (!Array.isArray(v) || v[2] !== 1) continue;
        const a = Number(v[0]), b = Number(v[1]);
        const line = coords.slice(a, b + 1);
        if (line.length < 2) continue;
        lines.push(simplify(line));
        const prev = ranges[ranges.length - 1];
        if (prev && pathLength(coords.slice(prev[1], a + 1)) <= TOLL_GAP_M) prev[1] = b;
        else ranges.push([a, b]);
    }
    const distance = lines.length ? ranges.reduce((m, [a, b]) => m + pathLength(coords.slice(a, b + 1)), 0) : 0;

    // Land je Abschnitt. Geht ein Abschnitt über eine Grenze (z.B. Brenner: A13 → A22),
    // wird die Grenze per Intervallhalbierung gesucht und der Abschnitt dort geteilt.
    const cache = new Map<number, Promise<string>>();
    const country = (i: number) => {
        let c = cache.get(i);
        if (!c) {
            c = countryAt(coords[i][0], coords[i][1], key).then((x) => x ?? '?');
            cache.set(i, c);
        }
        return c;
    };
    type Part = { country: string; a: number; b: number };
    async function split(a: number, b: number, depth = 0): Promise<Part[]> {
        const ca = await country(a), cb = await country(b);
        if (ca === cb || b - a < 2 || depth > 4) return [{ country: ca, a, b }];
        let lo = a, hi = b; // country(lo) = ca, country(hi) ≠ ca
        while (hi - lo > 1) {
            const m = Math.floor((lo + hi) / 2);
            if ((await country(m)) === ca) lo = m; else hi = m;
        }
        return [{ country: ca, a, b: hi }, ...(await split(hi, b, depth + 1))];
    }
    // Nacheinander statt parallel, damit das Minutenlimit der Geocodierung nicht greift
    const parts: Part[] = [];
    for (const [a, b] of ranges) parts.push(...(await split(a, b)));

    // Zusätzlich an den Orten teilen, damit jeder Abschnitt genau einer Etappe zugeordnet ist
    const sections: TollSection[] = [];
    parts.forEach((p, part) => {
        for (let leg = 0; leg < wayPoints.length - 1; leg++) {
            const a = Math.max(p.a, wayPoints[leg]), b = Math.min(p.b, wayPoints[leg + 1]);
            if (b <= a) continue;
            const mid = coords[Math.floor((a + b) / 2)];
            sections.push({ country: p.country, distance: pathLength(coords.slice(a, b + 1)), leg, part, at: mid });
        }
    });
    return { lines, distance, sections };
}

/** Land (ISO-3166 Alpha-2) an einem Punkt über das ORS-Reverse-Geocoding */
async function countryAt(lat: number, lon: number, key: string): Promise<string | null> {
    return (await countryOrs(lat, lon, key)) ?? (await countryPhoton(lat, lon));
}

/** Geocoding-Anfrage an ORS; der Key geht wie beim Routing im Authorization-Header mit. */
async function orsGeocode(path: string, params: Record<string, string>, key: string): Promise<Response> {
    const res = await fetch(`${ORS}/geocode/${path}?${new URLSearchParams(params)}`, {
        headers: { Authorization: key, Accept: 'application/json' },
    });
    if (!res.ok && res.status !== 429) {
        const body = await res.clone().text().catch(() => '');
        console.warn(`ORS-Geocoding ${path}: ${res.status} ${body.slice(0, 200)}`);
    }
    return res;
}

/** Lehnt ORS das Geocoding ab (z.B. 403), wird 10 Minuten lang direkt Photon gefragt. */
let orsGeocodingBlockedUntil = 0;
const orsGeocodingBlocked = () => Date.now() < orsGeocodingBlockedUntil;
const blockOrsGeocoding = () => { orsGeocodingBlockedUntil = Date.now() + 10 * 60_000; };

async function countryOrs(lat: number, lon: number, key: string): Promise<string | null> {
    if (orsGeocodingBlocked()) return null;
    const params = { 'point.lat': String(lat), 'point.lon': String(lon), size: '1' };
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await orsGeocode('reverse', params, key);
            if (res.status === 429 && attempt === 0) {
                // Minutenlimit der ORS-Geocodierung – kurz warten und nochmal
                await new Promise((r) => setTimeout(r, 1500));
                continue;
            }
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) blockOrsGeocoding();
                return null;
            }
            const p = ((await res.json()) as any)?.features?.[0]?.properties;
            const c = typeof p?.country_code === 'string' ? p.country_code : ISO3[p?.country_a];
            return c ? String(c).toUpperCase() : null;
        } catch (e) {
            console.warn('Land per ORS nicht bestimmbar:', e);
            return null;
        }
    }
    return null;
}

/** Ausweichlösung ohne Key: Photon (OpenStreetMap) liefert „countrycode“ */
async function countryPhoton(lat: number, lon: number): Promise<string | null> {
    try {
        const qs = new URLSearchParams({ lat: String(lat), lon: String(lon), limit: '1' });
        const res = await fetch(`${PHOTON}/reverse?${qs}`, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) return null;
        const c = ((await res.json()) as any)?.features?.[0]?.properties?.countrycode;
        return typeof c === 'string' ? c.toUpperCase() : null;
    } catch {
        return null;
    }
}

const ISO3: Record<string, string> = {
    DEU: 'DE', AUT: 'AT', ITA: 'IT', CHE: 'CH', FRA: 'FR', ESP: 'ES', PRT: 'PT', SVN: 'SI', HRV: 'HR', SMR: 'SM',
    LIE: 'LI', BEL: 'BE', NLD: 'NL', LUX: 'LU', CZE: 'CZ', POL: 'PL', HUN: 'HU', DNK: 'DK', GRC: 'GR',
};

/** Länge eines Linienzugs aus [lat, lon]-Punkten in Metern */
function pathLength(pts: [number, number][]): number {
    let m = 0;
    for (let i = 1; i < pts.length; i++) {
        const [la1, lo1] = pts[i - 1], [la2, lo2] = pts[i];
        const r = Math.PI / 180;
        const dLat = (la2 - la1) * r, dLon = (lo2 - lo1) * r;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLon / 2) ** 2;
        m += 2 * 6371000 * Math.asin(Math.sqrt(h));
    }
    return m;
}

function sqDist(a: [number, number], b: [number, number]): number {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

/** Ramer-Douglas-Peucker (iterativ), Toleranz in Grad (~0.0003° ≈ 30 m). */
function simplify(pts: [number, number][], tol = 0.0003): [number, number][] {
    if (pts.length <= 2) return pts.length ? pts : [];
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    const tol2 = tol * tol;
    while (stack.length) {
        const [s, e] = stack.pop()!;
        let maxD = 0, idx = -1;
        const [ax, ay] = pts[s], [bx, by] = pts[e];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        for (let i = s + 1; i < e; i++) {
            const [px, py] = pts[i];
            let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            const qx = ax + t * dx - px, qy = ay + t * dy - py;
            const d = qx * qx + qy * qy;
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (idx >= 0 && maxD > tol2) {
            keep[idx] = 1;
            stack.push([s, idx], [idx, e]);
        }
    }
    return pts.filter((_, i) => keep[i]).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)] as [number, number]);
}

// -- Geocoding -----------------------------------------------------

export async function geocode(text: string): Promise<GeocodeResult[]> {
    const key = orsKey();
    if (key && !orsGeocodingBlocked()) {
        const res = await orsGeocode('autocomplete', { text, size: '6', lang: 'de' }, key);
        if (res.ok) return fromGeoJson(await res.json());
        if (res.status === 401 || res.status === 403) blockOrsGeocoding();
        // sonst weiter mit Photon
    }
    const qs = new URLSearchParams({ q: text, limit: '6', lang: 'de' });
    const res = await fetch(`${PHOTON}/api/?${qs}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new RoutingError(`Ortssuche fehlgeschlagen (${res.status})`);
    return fromGeoJson(await res.json());
}

export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeResult | null> {
    const key = orsKey();
    let json: unknown;
    if (key && !orsGeocodingBlocked()) {
        const res = await orsGeocode('reverse', {
            'point.lat': String(lat), 'point.lon': String(lon), size: '1', lang: 'de',
            layers: 'locality,localadmin,neighbourhood,venue',
        }, key);
        if (res.ok) json = await res.json();
        else if (res.status === 401 || res.status === 403) blockOrsGeocoding();
    }
    if (!json) {
        const qs = new URLSearchParams({ lat: String(lat), lon: String(lon), limit: '1', lang: 'de' });
        const res = await fetch(`${PHOTON}/reverse?${qs}`, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) return null;
        json = await res.json();
    }
    return fromGeoJson(json)[0] ?? null;
}

/** ORS (Pelias) und Photon liefern beide GeoJSON-FeatureCollections, nur mit anderen Properties. */
function fromGeoJson(json: any): GeocodeResult[] {
    const features: any[] = json?.features ?? [];
    return features.map((f) => {
        const p = f.properties ?? {};
        const [lon, lat] = f.geometry?.coordinates ?? [0, 0];
        const name: string = p.name ?? p.city ?? p.locality ?? p.label ?? 'Ort';
        const label: string = p.label
            ?? [p.name, p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(', ');
        return { name, label, lat, lon };
    });
}
