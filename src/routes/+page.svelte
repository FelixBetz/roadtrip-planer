<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData, ActionData } from "./$types.js";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let showCreate = $state(false);
  let creating = $state(false);
</script>

<svelte:head>
  <title>Roadtrip-Planer – Meine Reisen</title>
</svelte:head>

<div class="dashboard">
  <header class="dash-header">
    <div class="dash-header-left">
      <h1>🚗 Roadtrip-Planer</h1>
      <p class="welcome">Hallo, <strong>{data.user.username}</strong></p>
    </div>
    <form method="POST" action="/logout">
      <button type="submit" class="logout-btn">Abmelden</button>
    </form>
  </header>

  <section class="tours-section">
    <div class="tours-header">
      <h2>Meine Reisen</h2>
      <button class="create-btn" onclick={() => (showCreate = !showCreate)}>
        {showCreate ? "✕ Abbrechen" : "+ Neue Reise"}
      </button>
    </div>

    {#if showCreate}
      <form
        method="POST"
        action="?/create"
        use:enhance={() => {
          creating = true;
          return async ({ update }) => {
            creating = false;
            await update();
          };
        }}
        class="create-form"
      >
        {#if form?.createError}
          <p class="error">{form.createError}</p>
        {/if}
        <input
          name="name"
          type="text"
          placeholder="Name der Reise, z.B. Ulm – Rom"
          required
          maxlength="100"
        />
        <input
          name="description"
          type="text"
          placeholder="Beschreibung (optional)"
          maxlength="300"
        />
        <button type="submit" disabled={creating}>
          {creating ? "Erstelle…" : "Reise anlegen"}
        </button>
      </form>
    {/if}

    {#if data.trips.length === 0}
      <div class="empty">
        <p>Noch keine Reisen. Plane deinen ersten Roadtrip!</p>
      </div>
    {:else}
      <ul class="tour-list">
        {#each data.trips as trip (trip.id)}
          <li class="tour-card">
            <a class="tour-link" href="/trip/{trip.id}">
              <span class="tour-name">{trip.name}</span>
              {#if trip.description}
                <span class="tour-desc">{trip.description}</span>
              {/if}
              <span class="tour-date"
                >{new Date(trip.created_at).toLocaleDateString("de-DE")}</span
              >
            </a>
            <form
              method="POST"
              action="?/delete"
              use:enhance
              class="delete-form"
            >
              <input type="hidden" name="id" value={trip.id} />
              <button
                type="submit"
                class="delete-btn"
                onclick={(e) => {
                  if (
                    !confirm(
                      "Reise wirklich löschen? Alle Daten werden entfernt.",
                    )
                  )
                    e.preventDefault();
                }}>🗑</button
              >
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    background: #f3f4f6;
    color: #111827;
  }

  .dashboard {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  .dash-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2rem;
    gap: 1rem;
  }

  .dash-header-left h1 {
    margin: 0;
    font-size: 1.6rem;
    color: #1e3a8a;
  }
  .welcome {
    margin: 0.2rem 0 0;
    color: #6b7280;
    font-size: 0.9rem;
  }

  .logout-btn {
    padding: 0.5rem 1rem;
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.15s;
  }
  .logout-btn:hover {
    background: #e5e7eb;
  }

  .tours-section {
    background: white;
    border-radius: 16px;
    padding: 1.5rem;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  }

  .tours-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  .tours-header h2 {
    margin: 0;
    font-size: 1.2rem;
  }

  .create-btn {
    padding: 0.45rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.9rem;
    transition: background 0.15s;
  }
  .create-btn:hover {
    background: #2563eb;
  }

  .create-form {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
    padding: 1rem;
    background: #f9fafb;
    border-radius: 10px;
  }
  .create-form input {
    flex: 1 1 200px;
    padding: 0.55rem 0.8rem;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 0.95rem;
  }
  .create-form button {
    padding: 0.55rem 1.2rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
  }
  .create-form button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error {
    width: 100%;
    background: #fef2f2;
    color: #dc2626;
    border-radius: 8px;
    padding: 0.5rem 0.8rem;
    font-size: 0.9rem;
    margin: 0;
  }

  .empty {
    text-align: center;
    color: #9ca3af;
    padding: 2rem 0;
  }

  .tour-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tour-card {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .tour-card:hover {
    border-color: #3b82f6;
  }

  .tour-link {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 0.8rem 1rem;
    text-decoration: none;
    color: inherit;
    gap: 0.15rem;
  }

  .tour-name {
    font-weight: 600;
    font-size: 1rem;
  }
  .tour-desc {
    font-size: 0.85rem;
    color: #6b7280;
  }
  .tour-date {
    font-size: 0.78rem;
    color: #9ca3af;
    margin-top: 0.1rem;
  }

  .delete-form {
    padding: 0.5rem;
  }
  .delete-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0.4rem;
    border-radius: 6px;
    transition: background 0.15s;
  }
  .delete-btn:hover {
    background: #fef2f2;
  }

  /* ── Mobile ── */
  @media (max-width: 480px) {
    .dashboard {
      padding: 1.25rem 0.75rem;
    }

    .dash-header-left h1 {
      font-size: 1.3rem;
    }

    .tours-section {
      padding: 1rem;
    }

    .create-form {
      flex-direction: column;
    }

    .create-form input {
      flex: none;
      width: 100%;
    }

    .create-form button {
      width: 100%;
    }
  }
</style>
