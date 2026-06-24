# Note sul fork — dashboard nutrizionale

Questo fork aggiunge una **dashboard web di sola lettura** (installabile come PWA su iPhone) al server `nutrition-mcp`, senza introdurre un backend separato: è una rotta in più dentro l'app Hono esistente, che legge lo stesso database Supabase usato dall'endpoint MCP.

## Cosa fa
- Vista per giornata: schede metriche (calorie, proteine, carboidrati, grassi, **fibra**, acqua), grafico calorie per pasto, e tabelle per pasto con subtotali e totale giornaliero.
- Navigazione tra i giorni (←/→/oggi).
- Login a cookie con le **stesse credenziali** dell'account Supabase del connettore MCP.
- Installabile come app su iPhone/desktop (manifest + service worker).
- **Sola lettura**: per registrare o correggere pasti si continua a usare la chat (gli strumenti MCP). La dashboard non muta dati.

## La fibra
Lo schema upstream non ha una colonna per la fibra. Per scelta, la fibra resta nel campo libero `notes` di ogni pasto, nel formato `Fibra: X g`, scritta una volta al momento della registrazione. La dashboard la **rilegge** dalle note con `parseFiberFromNotes` (`src/fiber.ts`), che riconosce:
1. il tag esplicito `fiber_g=N` (prioritario, non ambiguo);
2. l'etichetta umana `Fibra: N g` / `Fiber: N g` (il formato in uso).
Accetta decimali e la virgola come separatore; in assenza di valore restituisce 0. Nessun calcolo a runtime: è pura estrazione.

## File aggiunti
```
src/fiber.ts                      parser fibra dalle note (+ fiber.test.ts)
src/dashboard-aggregate.ts        aggregazione PURA giorno→vista (+ .test.ts)
src/dashboard-data.ts             fetch meals/water/goals + chiamata all'aggregatore
src/dashboard-sessions.ts         sessioni cookie (tabella dashboard_sessions)
src/dashboard.ts                  router: login/logout/sessione + API giorno
public/dashboard.html|css|js      front-end PWA (vanilla, zero dipendenze)
public/manifest.webmanifest       manifest PWA
public/sw.js                      service worker (cache shell; mai /api/*)
supabase/migrations/20260624120000_dashboard_sessions.sql
docs/ARCHITECTURE-AWS.md, DEPLOY-AWS.md, TESTING.md, FORK-NOTES.md
```

## File modificati
- `src/index.ts`: monta il router della dashboard e serve `/dashboard`, gli asset, il manifest e `sw.js`.
- `src/supabase.ts`: `deleteAllUserData` ora elimina anche le righe in `dashboard_sessions` (cancellazione account completa).
- `.env.example`: documentata `ALLOWED_ORIGINS` (opzionale).

## API (sola lettura, cookie di sessione)
```
GET  /api/dashboard/session         -> { authenticated: boolean }
POST /api/dashboard/login           { email, password } -> set-cookie; { ok: true }
POST /api/dashboard/logout          -> cancella cookie
GET  /api/dashboard/day/:date       :date = YYYY-MM-DD | "today" -> DayView
```
`DayView` raggruppa i pasti in ordine canonico (colazione, pranzo, cena, spuntino), con subtotali per pasto, totale di giornata (fibra inclusa), acqua e obiettivi.

## Scelte e limiti
- Nessuna nuova dipendenza nel front-end: la fibra non giustifica un framework. Grafico in CSS puro, DOM costruito con `textContent` (niente `innerHTML` su dati utente → niente XSS).
- I due spuntini della stessa giornata confluiscono nell'unico gruppo "Spuntino" con subtotale combinato: è ciò che il modello dati (solo `meal_type`) effettivamente conosce.
- L'anomalia nota sui dati del 2026-06-23 (zucca Hokkaidō con proteine = carboidrati, probabile refuso d'inserimento) resta tale: la dashboard mostra i dati come sono, non li corregge.
- Sicurezza: cookie `HttpOnly`/`SameSite=Lax`/`Secure` su HTTPS; tabella sessioni con RLS senza policy (solo service-role); throttle login per-IP in memoria (per scalare: WAF).

## Compatibilità con l'upstream
Nessuna modifica distruttiva: lo schema esistente è invariato, viene solo aggiunta una tabella. L'endpoint `/mcp` e il comportamento degli strumenti restano identici. Il merge da upstream dovrebbe restare pulito (i file nuovi non collidono; le due modifiche a file esistenti sono additive).
