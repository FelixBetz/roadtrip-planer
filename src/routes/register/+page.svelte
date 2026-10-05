<script lang="ts">
  import type { ActionData } from "./$types.js";

  let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
  <title>Registrieren</title>
</svelte:head>

<div class="auth-wrap">
  <div class="auth-box">
    <div class="auth-icon">🚗</div>
    <h1>Konto erstellen</h1>
    <p class="subtitle">Registriere dich, um Roadtrips zu planen.</p>

    <form method="POST">
      {#if form?.error}
        <p class="error">{form.error}</p>
      {/if}
      <label>
        Benutzername
        <input
          type="text"
          name="username"
          required
          minlength="3"
          maxlength="32"
          autocomplete="username"
        />
      </label>
      <label>
        Passwort
        <input
          type="password"
          name="password"
          required
          minlength="8"
          autocomplete="new-password"
        />
      </label>
      <label>
        Passwort bestätigen
        <input
          type="password"
          name="passwordConfirm"
          required
          autocomplete="new-password"
        />
      </label>
      <button type="submit">Registrieren</button>
    </form>

    <p class="switch">Bereits ein Konto? <a href="/login">Anmelden</a></p>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    background: #f3f4f6;
    color: #111827;
  }

  .auth-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .auth-box {
    background: white;
    border-radius: 16px;
    padding: 2.5rem;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
    text-align: center;
  }

  .auth-icon {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.6rem;
    color: #1e3a8a;
  }

  .subtitle {
    color: #6b7280;
    font-size: 0.9rem;
    margin: 0 0 1.5rem;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    text-align: left;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.9rem;
    font-weight: 500;
  }

  input {
    padding: 0.6rem 0.8rem;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus {
    border-color: #3b82f6;
  }

  button {
    margin-top: 0.5rem;
    padding: 0.7rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  button:hover {
    background: #2563eb;
  }

  .error {
    background: #fef2f2;
    color: #dc2626;
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    font-size: 0.9rem;
    margin: 0;
  }

  .switch {
    margin-top: 1.25rem;
    font-size: 0.88rem;
    color: #6b7280;
  }
  .switch a {
    color: #2563eb;
    text-decoration: none;
    font-weight: 500;
  }
  .switch a:hover {
    text-decoration: underline;
  }
</style>
