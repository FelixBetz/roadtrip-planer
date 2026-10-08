import { error } from '@sveltejs/kit';
import { getTrip, getTripRoute, setTripRoute, isTripMember, getAllStops } from '$lib/db.js';
import { computeRoute, routeKey, RoutingError, type RouteOptions } from './routing.js';
import type { RouteData, Stop, Trip, User } from '$lib/types.js';

/** Lädt die Reise und prüft, dass der eingeloggte Nutzer sie besitzt oder sie mit ihm geteilt ist. */
export async function requireTrip(user: User | null, idParam: string): Promise<Trip> {
    if (!user) error(401, 'Nicht angemeldet');
    const id = parseInt(idParam, 10);
    if (isNaN(id)) error(404, 'Reise nicht gefunden');
    const trip = await getTrip(id);
    if (!trip) error(404, 'Reise nicht gefunden');
    if (trip.user_id !== user.id && !(await isTripMember(trip.id, user.id))) error(403, 'Nicht berechtigt');
    return trip;
}

export function routeOptions(trip: Trip): RouteOptions {
    return { avoidHighways: Boolean(trip.avoid_highways), avoidTolls: Boolean(trip.avoid_tolls) };
}

export interface RouteState {
    route: RouteData | null;
    routeError: string | null;
}

/**
 * Liefert die zu den Stopps passende Route. Ist die gespeicherte Route veraltet
 * (Stopps oder Optionen geändert), wird neu berechnet und gespeichert.
 */
export async function ensureRoute(trip: Trip, stops: Stop[]): Promise<RouteState> {
    if (stops.length < 2) {
        return { route: null, routeError: null };
    }
    const opts = routeOptions(trip);
    const cached = await getTripRoute(trip.id);
    if (cached && cached.key === routeKey(stops, opts)) {
        return { route: cached, routeError: null };
    }
    try {
        const route = await computeRoute(stops, opts);
        await setTripRoute(trip.id, route);
        return { route, routeError: null };
    } catch (e) {
        const msg = e instanceof RoutingError ? e.message : 'Routing-Dienst nicht erreichbar.';
        console.error('Routing failed:', e);
        return { route: null, routeError: msg };
    }
}

/** Kompletter aktueller Stand einer Reise (für Seitenaufruf, Abgleich und Konflikte). */
export async function loadTripState(trip: Trip): Promise<{ trip: Trip; stops: Stop[] } & RouteState> {
    const stops = await getAllStops(trip.id);
    return { trip, stops, ...(await ensureRoute(trip, stops)) };
}
