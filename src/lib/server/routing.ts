/**
 * Auto-Routing + Geocoding.
 *
 * Mit ORS_API_KEY  → OpenRouteService (Autobahn/Maut meiden zuverlässig, max. 50 Punkte)
 * Ohne Key         → öffentlicher OSRM-Demo-Server + Photon (nur zum Ausprobieren)
 */
import { env } from '$env/dynamic/private';
import type { GeocodeResult, RouteData, RouteLeg } from '$lib/types.js';

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
    return `${p}|h${opts.avoidHighways ? 1 : 0}t${opts.avoidTolls ? 1 : 0}|${orsKey() ? 'ors' : 'osrm'}`;
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
        instructions: false,
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
    const segments: { distance: number; duration: number }[] = feature?.properties?.segments ?? [];
    const wayPoints: number[] = feature?.properties?.way_points ?? [];
    if (!coords.length || segments.length !== points.length - 1 || wayPoints.length !== points.length) {
        throw new RoutingError('OpenRouteService: unerwartete Antwort.');
    }

    const legs: RouteLeg[] = segments.map((seg, i) => ({
        coords: simplify(coords.slice(wayPoints[i], wayPoints[i + 1] + 1)),
        distance: seg.distance ?? 0,
        duration: seg.duration ?? 0,
    }));
    return finish('ors', legs);
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
    if (key) {
        const qs = new URLSearchParams({ api_key: key, text, size: '6', lang: 'de' });
        const res = await fetch(`${ORS}/geocode/autocomplete?${qs}`);
        if (!res.ok) throw new RoutingError(`Ortssuche fehlgeschlagen (${res.status})`);
        return fromGeoJson(await res.json());
    }
    const qs = new URLSearchParams({ q: text, limit: '6', lang: 'de' });
    const res = await fetch(`${PHOTON}/api/?${qs}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new RoutingError(`Ortssuche fehlgeschlagen (${res.status})`);
    return fromGeoJson(await res.json());
}

export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeResult | null> {
    const key = orsKey();
    let json: unknown;
    if (key) {
        const qs = new URLSearchParams({
            api_key: key, 'point.lat': String(lat), 'point.lon': String(lon), size: '1', lang: 'de',
            layers: 'locality,localadmin,neighbourhood,venue',
        });
        const res = await fetch(`${ORS}/geocode/reverse?${qs}`);
        if (!res.ok) return null;
        json = await res.json();
    } else {
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
