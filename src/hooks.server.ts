import { redirect, type Handle } from '@sveltejs/kit';
import { getAuthSession, getUserById } from '$lib/db.js';

const PUBLIC_PATHS = ['/login', '/register'];

export const handle: Handle = async ({ event, resolve }) => {
    const token = event.cookies.get('auth_token');

    if (token) {
        const session = await getAuthSession(token);
        if (session && new Date(session.expires_at) > new Date()) {
            event.locals.user = await getUserById(session.user_id);
        } else {
            event.cookies.delete('auth_token', { path: '/' });
            event.locals.user = null;
        }
    } else {
        event.locals.user = null;
    }

    const path = event.url.pathname;
    const isPublic = PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'));

    if (!event.locals.user && !isPublic) {
        redirect(303, '/login');
    }

    return resolve(event);
};
