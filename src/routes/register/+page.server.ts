import { fail, redirect } from '@sveltejs/kit';
import { getUserByUsername, createUser } from '$lib/db.js';
import { hashPassword, startSession } from '$lib/auth.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = ({ locals }) => {
    if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
    default: async ({ request, cookies }) => {
        const data = await request.formData();
        const username = String(data.get('username') ?? '').trim();
        const password = String(data.get('password') ?? '');
        const passwordConfirm = String(data.get('passwordConfirm') ?? '');

        if (!username || !password) {
            return fail(400, { error: 'Bitte alle Felder ausfüllen.' });
        }
        if (username.length < 3 || username.length > 32) {
            return fail(400, { error: 'Benutzername muss 3–32 Zeichen lang sein.' });
        }
        if (password.length < 8) {
            return fail(400, { error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
        }
        if (password !== passwordConfirm) {
            return fail(400, { error: 'Passwörter stimmen nicht überein.' });
        }

        const existing = await getUserByUsername(username);
        if (existing) {
            return fail(409, { error: 'Benutzername bereits vergeben.' });
        }

        const hash = await hashPassword(password);
        const user = await createUser(username, hash);
        const token = await startSession(user.id);

        cookies.set('auth_token', token, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 30,
        });

        redirect(303, '/');
    },
};
