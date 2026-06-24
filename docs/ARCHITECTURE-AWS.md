# Architettura AWS — Nutrition MCP + Dashboard

Questo fork serve **due superfici dallo stesso processo Hono**:

- `ALL /mcp` — l'endpoint MCP per i client AI (Claude, ChatGPT), autenticato con bearer token OAuth.
- `/dashboard` + `/api/dashboard/*` — la PWA di sola lettura, autenticata con cookie di sessione.

Entrambe leggono lo stesso database Supabase. Non c'è un backend separato: la dashboard è una rotta in più nell'app esistente, esattamente come da decisione (fork invece di servizio a parte).

## Topologia consigliata

```
  iPhone / laptop (PWA)  ─┐
                          ├── HTTPS ──▶  AWS App Runner  ──▶  Supabase (managed)
  Claude / ChatGPT (/mcp)─┘             (container Hono,        • Postgres (meals, water,
                                         porta 8080)              goals, sessions, oauth)
                                            │                   • Auth (email/password)
                                            ├─ Secrets Manager   • Storage (export CSV)
                                            │   (chiavi runtime)
                                            └─ CloudWatch (log/metriche)

  Route 53 (DNS)  +  ACM (TLS gestito da App Runner per il dominio custom)
```

### Perché App Runner
È l'equivalente AWS del "DigitalOcean App Platform" citato nel README upstream: prende un'immagine container (o build da sorgente), espone HTTPS gestito, autoscaling, health check, e legge i secret da Secrets Manager. Nessun load balancer, nessuna VPC da gestire. Per un'app personale a basso traffico è la via più snella.

Health check: `GET /health` (già presente, risponde `ok`).

### Perché Supabase resta fuori da AWS
L'app è costruita su Supabase **Auth + Postgres + Storage + RLS** (la chiave service-role bypassa RLS lato server). Migrare a RDS significherebbe riscrivere l'autenticazione: non ne vale la pena. Supabase è managed e il free tier copre ampiamente un singolo utente.

## Secret e configurazione

| Variabile | Dove | Note |
|---|---|---|
| `SUPABASE_URL` | App Runner env (plain) | URL progetto |
| `SUPABASE_SECRET_KEY` | **Secrets Manager** | service-role key, bypassa RLS |
| `OAUTH_CLIENT_ID` | App Runner env (plain) | |
| `OAUTH_CLIENT_SECRET` | **Secrets Manager** | |
| `ALLOWED_ORIGINS` | App Runner env (plain), opzionale | solo se la PWA è servita da un'origine diversa; nella stessa origine **non serve** |
| `PORT` | `8080` | |

La dashboard è same-origin rispetto all'API, quindi non servono regole CORS aggiuntive: il `connect-src 'self'` della CSP esistente già la copre.

## Sicurezza

- Cookie di sessione `dash_session`: `HttpOnly`, `SameSite=Lax`, `Secure` quando la richiesta è HTTPS (dietro App Runner lo è sempre, via `x-forwarded-proto`).
- Sessioni in tabella `dashboard_sessions` con RLS attiva e nessuna policy → raggiungibili solo dalla service-role.
- Throttle login per-IP in memoria (10 tentativi / 15 min). È per-istanza e si azzera al restart: con una sola istanza basta. Se in futuro scali a più istanze o temi traffico ostile, aggiungi **AWS WAF** con una rate-based rule davanti al servizio (App Runner si integra con WAF).
- Le credenziali di login sono le stesse dell'account Supabase usato dal connettore MCP: un solo set di credenziali per entrambe le superfici.

## Osservabilità
App Runner instrada stdout/stderr e le metriche (richieste, latenza, CPU/mem) su **CloudWatch**. I log dell'app sono volutamente parchi (nessun dato personale nei log).

## Costo indicativo (eu-central-1, uso personale)
- App Runner 0.25 vCPU / 0.5 GB: ~5–8 USD/mese a riposo (non scala a zero) + traffico trascurabile.
- Route 53 hosted zone: 0,50 USD/mese.
- Secrets Manager: ~0,40 USD per secret/mese.
- Supabase: free tier.
- **Totale ~6–10 USD/mese.**

## Alternative (se vuoi ottimizzare)
- **Lightsail Containers** (nano/micro ~7 USD/mese, prezzo fisso): più semplice e prevedibile di App Runner, stesso modello a container. Buona scelta "personale".
- **ECS Fargate + ALB**: più controllo (VPC, target group, WAF nativo) ma più pezzi da gestire e l'ALB costa ~16 USD/mese da solo. Sovradimensionato qui.
- **Lambda + API Gateway**: lo streaming HTTP dell'MCP e una connessione persistente mal si sposano con il modello a invocazione; sconsigliato per questo server.

Raccomandazione: **App Runner** (o Lightsail se preferisci costo fisso). I passi in `DEPLOY-AWS.md` usano App Runner via immagine ECR.
