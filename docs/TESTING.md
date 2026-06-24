# Procedura passo passo — test locale

Prerequisiti: **Bun** installato, un progetto **Supabase** (anche free) con le sue chiavi, e le credenziali OAuth (lo script `generate-oauth-creds` le crea).

## 1. Dipendenze
```bash
bun install
```

## 2. Variabili d'ambiente
Crea `.env` partendo da `.env.example`:
```bash
cp .env.example .env
```
Compila:
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (Project Settings → API → service_role key)
- `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` → genera con `bun run generate-oauth-creds`
- `PORT=8080`

Bun carica `.env` da solo.

## 3. Applica la migrazione del DB
La dashboard richiede la tabella `dashboard_sessions`. Con la Supabase CLI collegata al progetto:
```bash
supabase db push
```
In alternativa, incolla il contenuto di
`supabase/migrations/20260624120000_dashboard_sessions.sql` nello **SQL Editor** di Supabase ed eseguilo.

## 4. Test unitari
```bash
bun test
```
Atteso: tutti verdi. Coprono il parser della fibra (`fiber.test.ts`) e l'aggregazione giorno per alimento/pasto/giornata, ordine dei pasti, fuso orario, acqua, obiettivi e arrotondamenti (`dashboard-aggregate.test.ts`).

## 5. Type-check (opzionale ma consigliato)
```bash
bunx tsc --noEmit
```
Nota: gli unici errori attesi sono in `scripts/gen-map-data.ts`, uno script offline preesistente non legato al server.

## 6. Avvia il server
```bash
bun run dev      # watch mode
# oppure
bun run start
```
Atteso nel log: `Nutrition MCP server listening on 0.0.0.0:8080`.

## 7. Verifica le rotte
```bash
curl -s localhost:8080/health                       # -> ok
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/dashboard          # -> 200
curl -s localhost:8080/api/dashboard/session         # -> {"authenticated":false}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/api/dashboard/day/2026-06-23  # -> 401 (senza cookie)
```

## 8. Flusso login + vista giornata (browser)
1. Apri `http://localhost:8080/dashboard`.
2. Accedi con l'email/password dell'account Supabase (le stesse del connettore MCP). Se non hai ancora un utente, crealo una volta col flusso OAuth del server, oppure via Supabase Auth.
3. Dovresti vedere le schede metriche (Calorie/Proteine/Carboidrati/Grassi/**Fibra**/Acqua), il grafico calorie per pasto e le tabelle per pasto con il subtotale.
4. Naviga con ←/→ e "oggi"; verifica una data con dati noti (es. `2026-06-23`).
5. "esci" deve riportare al login.

Controllo di coerenza: i totali della dashboard devono coincidere con quelli che la chat riporta via `get_meals_by_date` per la stessa data (la fibra è la somma dei valori nelle note).

## 9. Test PWA (installazione)
- **Desktop Chrome**: apri `/dashboard` → icona "Installa" nella barra indirizzi → l'app si apre in finestra standalone.
- **iPhone Safari**: apri l'URL → Condividi → "Aggiungi a Home". L'icona usa `apple-touch-icon.png`; l'app parte a tutto schermo su `/dashboard`.
- Verifica il service worker: DevTools → Application → Service Workers (deve risultare *activated*); le richieste `/api/*` **non** devono essere servite dalla cache.

> Nota PWA: il service worker richiede un contesto sicuro (HTTPS, oppure `localhost`). In locale `localhost` è già considerato sicuro, quindi funziona senza certificato.
