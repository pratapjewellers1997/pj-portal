# Pratap Jewellers Portal

Company intranet portal. The **System Registry** (`2. SYSTEM REGISTRY`) is the engine; this repo holds two thin layers on top of it:

| Folder | What it is | Runs on |
|---|---|---|
| `web/` | The website (plain JavaScript, built with Vite) | GitHub Pages |
| `api/` | The API (Apps Script web app, read-only on the Registry) | Google, as rohantodkar@ |

Rules: the API never writes to System Master. Google Drive permissions stay the real lock. No IDs or secrets are committed; they live in Script Properties and GitHub Variables.

## Step 1 setup: sign-in test

### A. Google Cloud OAuth client (once, from rohantodkar@)
1. Open console.cloud.google.com and create a project `PJ Portal`.
2. **APIs & Services > OAuth consent screen**: User type **External**, app name `Pratap Jewellers Portal`, support email rohantodkar@. Scopes: leave the defaults (email, profile, openid). Then **Publish app** so personal Gmail staff can sign in.
3. **Credentials > Create credentials > OAuth client ID > Web application**.
   Authorised JavaScript origins:
   - `https://pratapjewellers1997.github.io`
   - `http://localhost:5173` (local testing)
4. Copy the **Client ID**.

### B. API (Apps Script, from rohantodkar@)
1. script.new, then name the project `PJ Portal API`.
2. Copy in the four `.gs` files from `api/`. In Project Settings, tick "Show appsscript.json" and paste `api/appsscript.json`.
3. **Project Settings > Script Properties**: add `REGISTRY_ID` (Registry v2 ID) and `OAUTH_CLIENT_ID`.
4. Run `setupSessionSecret` once, then `checkSetup` (accept permissions). The log should show three OKs and the People row count.
5. **Deploy > New deployment > Web app**: Execute as **Me**, access **Anyone**. Copy the `/exec` URL.

### C. GitHub
1. **Settings > Pages**: Source = **GitHub Actions**.
2. **Settings > Secrets and variables > Actions > Variables**: add `VITE_API_URL` (the `/exec` URL) and `VITE_GOOGLE_CLIENT_ID`.
3. **Actions > Deploy website > Run workflow**.
4. Open `https://pratapjewellers1997.github.io/pj-portal/` and sign in.

### Test cases
- rohantodkar@ shows Role **Admin**.
- A personal Gmail staff member shows Role **Doer**.
- mis@ and any unknown account show "not in the staff list".

## Local development
```
cp .env.example .env.local   # fill in both values
npm install
npm run dev                  # http://localhost:5173
```

## API actions
POST, `Content-Type: text/plain`, JSON body:
- `{"action":"login","idToken":"…"}` → `{ok, session, user}`
- `{"action":"me","session":"…"}` → `{ok, user}`

Errors come back as `{ok:false, error:"not_registered" | "inactive" | "bad_token" | "session_expired" | …}`.
