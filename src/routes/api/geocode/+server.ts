import { json, error } from '@sveltejs/kit';
import { geocode, RoutingError } from '$lib/server/routing.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ url }) => {
    const q = url.searchParams.get('q')?.trim() ?? '';
    if (q.length < 2) return json([]);
    try {
        return json(await geocode(q.slice(0, 200)));
    } catch (e) {
        error(502, e instanceof RoutingError ? e.message : 'Ortssuche nicht erreichbar.');
    }
};
