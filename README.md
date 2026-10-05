# Roadtrip-Planer

Planer für mehrtägige Auto-Roadtrips (z.B. Ulm → Bozen → Bologna → Rom → Ulm).
Gleicher Tech-Stack wie der [Routenplaner](https://github.com/FelixBetz/Routenplaner):
SvelteKit 5 + TypeScript, Leaflet/OpenStreetMap, Neon Postgres, Hosting auf Vercel.

## Features

- **Strecke von A nach B (und zurück)**: Orte suchen und anhängen, die Autoroute wird automatisch berechnet
  (km + Fahrzeit pro Abschnitt). „↩ Zurück zum Start“ macht daraus eine Rundreise.
- **Etappenziele** (🏨 Übernachtung) teilen die Strecke in Fahrtage. Pro Etappenziel: Notizen, Ruhetage
  und Programm für die Ruhetage.
- **Zwischenziele** (📍 Sehenswürdigkeit, z.B. Verona auf Bozen → Bologna): Fahrzeit ab dem letzten Halt,
  geplante Aufenthaltsdauer, Notizen.
- **Route anpassen per Drag & Drop**: Strecke auf der Karte packen und auf die gewünschte Straße ziehen.
  Dabei entsteht ein unsichtbarer Wegpunkt (verschiebbar, Doppelklick entfernt ihn).
- **Klick auf die Strecke** fügt an dieser Stelle ein Etappen- oder Zwischenziel ein.
- **Autobahn meiden / Maut meiden** pro Reise.
- **Schematische Gesamtstrecke**: horizontale Leiste von Start bis Ziel mit allen Markern, Tagen,
  km und Fahrzeiten.
- **Tagesübersicht** (`/trip/[id]/summary`): Tag für Tag mit Datum, Fahrtagen, Ruhetagen,
  Zwischenzielen und Notizen, druckbar.

## Einrichtung

```sh
npm install
cp .env.example .env   # DATABASE_URL und ORS_API_KEY eintragen
npm run setup-db       # Tabellen anlegen
npm run dev
```

### Datenbank

Am einfachsten ein neues Neon-Projekt (oder einen neuen Branch) anlegen. Die Tabellen `users` und
`auth_sessions` sind identisch zum Routenplaner. Wer dieselbe Datenbank verwendet, teilt sich also
auch die Logins; die Reisedaten liegen getrennt in `trips` und `trip_stops`.

### Routing (OpenRouteService)

Kostenlosen API-Key holen: <https://openrouteservice.org/dev/#/signup> (2.000 Routen/Tag) und als
`ORS_API_KEY` eintragen. Ohne Key nutzt die App den öffentlichen OSRM-Demo-Server und Photon für die
Ortssuche. Das reicht zum Ausprobieren, aber „Autobahn/Maut meiden“ wird dort nicht zuverlässig
unterstützt.

## Deployment (Vercel)

Wie beim Routenplaner: Repo in Vercel importieren und die Umgebungsvariablen `DATABASE_URL` und
`ORS_API_KEY` setzen. `@sveltejs/adapter-vercel` ist bereits konfiguriert.

## Projektstruktur

```
src/lib/
  db.ts                     Neon-Zugriff (Users, Sessions, Trips, Stops, Route-Cache)
  plan.ts                   Tagesplanung aus Stopps + Route ableiten, Formatierung
  server/routing.ts         ORS/OSRM-Routing, Geocoding
  server/trip.ts            Berechtigung + Route neu berechnen, wenn Stopps sich ändern
  components/TripMap.svelte Leaflet-Karte inkl. Drag & Drop
  components/RouteStrip.svelte  schematische Gesamtstrecke
src/routes/
  trip/[id]/                Planung (Karte + Stopp-Liste)
  trip/[id]/summary/        Tagesübersicht
  api/trips/[id]/...        PATCH Reise, PUT Stopps, PATCH einzelner Stopp
  api/geocode/...           Ortssuche + Reverse-Geocoding
```
