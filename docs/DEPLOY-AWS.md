# Procedura passo passo — deploy su AWS (App Runner)

Strategia: immagine container su **ECR** → servizio **App Runner** → dominio custom via **Route 53 + ACM**. Database su **Supabase** (fuori da AWS).

> Questi passi li esegui tu: richiedono le tue credenziali AWS e creano risorse a pagamento. I comandi sono pronti da copiare. Imposta prima le variabili di shell che seguono.

```bash
export AWS_REGION=eu-central-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export REPO=nutrition-mcp
export ECR=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO
```

## 0. Prerequisiti
- AWS CLI configurata (`aws configure`), Docker, e il fork già su GitHub.
- Progetto Supabase con le migrazioni applicate (vedi sotto).

## 1. Applica la migrazione del DB su Supabase
La produzione usa lo stesso schema del locale. Assicurati che `dashboard_sessions` esista:
```bash
supabase db push      # oppure esegui il file SQL nello SQL Editor
```

## 2. Crea il repository ECR e pubblica l'immagine
```bash
aws ecr create-repository --repository-name $REPO --region $AWS_REGION

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Il Dockerfile del repo usa oven/bun ed espone la porta 8080.
docker build -t $REPO .
docker tag $REPO:latest $ECR:latest
docker push $ECR:latest
```
> Mac Apple Silicon: builda per l'architettura del servizio App Runner (x86_64) con
> `docker build --platform linux/amd64 -t $REPO .`

## 3. Salva i secret in Secrets Manager
```bash
aws secretsmanager create-secret --name nutrition/supabase-secret-key \
  --secret-string 'IL_TUO_SUPABASE_SERVICE_ROLE_KEY' --region $AWS_REGION
aws secretsmanager create-secret --name nutrition/oauth-client-secret \
  --secret-string 'IL_TUO_OAUTH_CLIENT_SECRET' --region $AWS_REGION
```
Annota gli ARN restituiti: servono al passo 5.

## 4. Ruolo di istanza (per leggere i secret)
App Runner inietta i secret tramite un **instance role** con permesso `secretsmanager:GetSecretValue`.
```bash
cat > /tmp/trust.json <<'JSON'
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow",
    "Principal": { "Service": "tasks.apprunner.amazonaws.com" },
    "Action": "sts:AssumeRole" } ] }
JSON

aws iam create-role --role-name AppRunnerNutritionInstance \
  --assume-role-policy-document file:///tmp/trust.json

aws iam put-role-policy --role-name AppRunnerNutritionInstance \
  --policy-name read-secrets --policy-document "{
    \"Version\":\"2012-10-17\",
    \"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",
      \"Resource\":[\"arn:aws:secretsmanager:$AWS_REGION:$ACCOUNT_ID:secret:nutrition/*\"]}]}"
```
App Runner ha anche bisogno di un **access role** per estrarre da ECR: la console lo crea in automatico (`AppRunnerECRAccessRole`); via CLI usa `--authentication-configuration AccessRoleArn=...`.

## 5. Crea il servizio App Runner
Via **console** (più semplice la prima volta): App Runner → Create service → *Container registry / Amazon ECR* → immagine `:latest` → porta **8080** → health check **HTTP `/health`** → variabili:

| Tipo | Nome | Valore |
|---|---|---|
| Plain | `SUPABASE_URL` | `https://xxxx.supabase.co` |
| Plain | `OAUTH_CLIENT_ID` | … |
| Plain | `PORT` | `8080` |
| Secret | `SUPABASE_SECRET_KEY` | ARN di `nutrition/supabase-secret-key` |
| Secret | `OAUTH_CLIENT_SECRET` | ARN di `nutrition/oauth-client-secret` |

Instance role: `AppRunnerNutritionInstance`. Auto-deploy: **on** (ridepoiega a ogni push su `:latest`).

Al termine ottieni un URL `https://<id>.<region>.awsapprunner.com`. Verifica:
```bash
curl -s https://<id>.<region>.awsapprunner.com/health      # -> ok
```

## 6. Dominio custom (Route 53 + ACM)
1. App Runner → il servizio → **Custom domains** → *Link domain* → es. `nutrition.iltuodominio.com`.
2. App Runner mostra record di validazione (CNAME) e il target. Creali nella hosted zone Route 53 (se la zona è in Route 53, l'associazione è guidata). Il certificato TLS è **gestito da App Runner** (ACM), nessun rinnovo manuale.
3. Attendi lo stato *Active* del dominio.

## 7. Collega i client
- Connettore MCP (Claude/ChatGPT): URL del server = `https://nutrition.iltuodominio.com/mcp`.
- Dashboard: `https://nutrition.iltuodominio.com/dashboard`.
- iPhone: apri la dashboard in Safari → Condividi → **Aggiungi a Home**.

## 8. Aggiornamenti futuri
```bash
docker build --platform linux/amd64 -t $REPO . && docker tag $REPO:latest $ECR:latest && docker push $ECR:latest
```
Con auto-deploy attivo, App Runner ridepoiega da solo. Le nuove migrazioni vanno applicate su Supabase **prima** del push.

## Note
- Il throttle login è in memoria e per-istanza: con una sola istanza va bene. Se aumenti `Max size` dell'autoscaling oltre 1, valuta **AWS WAF** con rate rule davanti al servizio.
- App Runner non scala a zero: c'è un costo base mensile (vedi `ARCHITECTURE-AWS.md`). Per costo fisso minimo, l'alternativa è Lightsail Containers con gli stessi env/secret.
