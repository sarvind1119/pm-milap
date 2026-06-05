# PM-MILAP — Azure Deployment Guide

This guide walks you through deploying PM-MILAP on **Azure App Service** with automatic
CI/CD via **GitHub Actions**. Every push to `main` will automatically redeploy the app.

**Target URL after deployment:** `https://pm-milap.azurewebsites.net`

---

## Prerequisites

Before you begin, make sure you have:

- [ ] An **Azure account** with an active subscription
- [ ] The **GitHub repository** at `https://github.com/sarvind1119/pm-milap`
- [ ] A **Groq API key** (free at https://console.groq.com — used for the AI assistant)
- [ ] Access to the **Azure Portal** at https://portal.azure.com

---

## Part 1 — Create Azure Resources

> **Skip this part if you already have an App Service named `pm-milap`.**

### 1.1 — Create a Resource Group

1. Go to https://portal.azure.com
2. Search **"Resource groups"** in the top search bar → click it
3. Click **`+ Create`**
4. Fill in:
   - **Subscription:** your subscription
   - **Resource group name:** `pm-milap-rg`
   - **Region:** pick the closest to your users (e.g., `Central India` or `East US`)
5. Click **Review + Create** → **Create**

---

### 1.2 — Create the App Service Plan

1. Search **"App Service plans"** → click **`+ Create`**
2. Fill in:
   - **Resource group:** `pm-milap-rg`
   - **Name:** `pm-milap-plan`
   - **Operating System:** `Linux`
   - **Region:** same region as above
   - **Pricing plan:** `Free F1` (click "Explore pricing plans" if not visible)
3. Click **Review + Create** → **Create**

---

### 1.3 — Create the Web App (App Service)

1. Search **"App Services"** → click **`+ Create`** → **Web App**
2. Fill in:

   | Field | Value |
   |---|---|
   | Subscription | your subscription |
   | Resource Group | `pm-milap-rg` |
   | Name | `pm-milap` |
   | Publish | `Code` |
   | Runtime stack | `Node 22 LTS` |
   | Operating System | `Linux` |
   | Region | same as above |
   | App Service Plan | `pm-milap-plan` (Free F1) |

3. Click **Review + Create** → **Create**
4. Wait ~1 minute for deployment to complete, then click **Go to resource**

---

## Part 2 — Configure the App Service

### 2.1 — Set the Startup Command & Runtime

1. Open your App Service **`pm-milap`**
2. In the left sidebar → **Settings** → **Configuration** → **General settings** tab
3. Confirm/set:
   - **Stack:** `Node`
   - **Major version:** `Node 22 LTS`
   - **Operating System:** `Linux` (read-only, just verify)
   - **Startup Command:** `npm start`
4. Click **`Save`** → **Continue**

---

### 2.2 — Add Application Settings (Environment Variables)

1. Still in **Configuration**, click the **Application settings** tab
2. For each row in the table below, click **`+ New application setting`**, enter the **Name** and **Value**, then click **OK**:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATA_DIR` | `/home/data` |
   | `JWT_SECRET` | *(generate one — see note below)* |
   | `LLM_ENABLED` | `true` |
   | `LLM_API_KEY` | *(your Groq API key — starts with `gsk_`)* |
   | `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
   | `LLM_MODEL` | `llama-3.1-8b-instant` |
   | `LLM_TIMEOUT_MS` | `60000` |
   | `LLM_JSON_MODE` | `auto` |
   | `MATCH_INTERVAL_MS` | `120000` |
   | `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |
   | `WEBSITES_PORT` | `3000` |

3. After adding all 12 settings, click **`Save`** (top of the page) → **Continue**

> ⚠️ **Important:** Do NOT add a `PORT` setting. Azure manages this internally.

> 🔑 **Generating a JWT_SECRET:** Run this once in your terminal and use the output:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

> 💡 **DATA_DIR=/home/data** stores the SQLite database on Azure's persistent `/home`
> filesystem, which survives restarts and redeployments. Without this, the database
> resets every time the app restarts.

---

## Part 3 — Set Up GitHub Actions CI/CD

The workflow file `.github/workflows/azure-deploy.yml` is already in the repository.
You just need to give GitHub the credentials to deploy to Azure.

There are **two methods** depending on your Azure security settings.

---

### Method A — Publish Profile (Simple, Recommended)

Use this if basic authentication is enabled on your App Service.

#### Step A1 — Enable Basic Authentication (if not already on)

1. App Service → **Settings** → **Configuration** → **General settings**
2. Find **"SCM Basic Auth Publishing Credentials"** → set to **On**
3. Find **"FTP Basic Auth Publishing Credentials"** → set to **On**
4. Click **Save**

#### Step A2 — Download the Publish Profile

1. Go to App Service **Overview** page (top of left sidebar)
2. In the top toolbar, click **`Download publish profile`**
3. A file named **`pm-milap.PublishSettings`** downloads to your computer
4. Open it in **Notepad** (or any text editor) — you'll need its full contents

> ⚠️ This file contains deployment credentials. Do not commit it to git or share it publicly.

#### Step A3 — Add the Publish Profile as a GitHub Secret

1. Go to: https://github.com/sarvind1119/pm-milap/settings/secrets/actions
2. Click **`New repository secret`**
3. Fill in:
   - **Name:** `AZURE_WEBAPP_PUBLISH_PROFILE`
   - **Secret:** paste the **entire contents** of the `.PublishSettings` file
     (the full XML, starting with `<publishData` and ending with `</publishData>`)
4. Click **`Add secret`**

---

### Method B — Service Principal (If Basic Auth is Disabled by Policy)

Use this if you see "Basic authentication is disabled" when trying to download the publish profile.

#### Step B1 — Create a Service Principal

Open **Azure Cloud Shell** (click the `>_` icon in the top-right of the Azure portal) and run:

```bash
az ad sp create-for-rbac \
  --name "pm-milap-github" \
  --role contributor \
  --scopes /subscriptions/<YOUR_SUBSCRIPTION_ID>/resourceGroups/<YOUR_RESOURCE_GROUP> \
  --json-auth
```

Replace:
- `<YOUR_SUBSCRIPTION_ID>` — found on the Overview page (e.g., `d98117fa-54c5-...`)
- `<YOUR_RESOURCE_GROUP>` — the resource group name (e.g., `pm-milap-rg`)

The command outputs a JSON block like:
```json
{
  "clientId": "...",
  "clientSecret": "...",
  "subscriptionId": "...",
  "tenantId": "...",
  ...
}
```

#### Step B2 — Add as GitHub Secret

1. Go to: https://github.com/sarvind1119/pm-milap/settings/secrets/actions
2. Click **`New repository secret`**
3. Fill in:
   - **Name:** `AZURE_CREDENTIALS`
   - **Secret:** paste the entire JSON output from the command above
4. Click **`Add secret`**

#### Step B3 — Update the Workflow File

The current workflow uses publish profile authentication. If you used Method B,
update `.github/workflows/azure-deploy.yml` to use the service principal:

```yaml
name: Deploy to Azure App Service

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Azure Login
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v3
        with:
          app-name: 'pm-milap'
          package: .
```

Commit and push this change to trigger the deployment.

---

## Part 4 — Trigger & Verify Deployment

### 4.1 — Trigger the Deployment

1. Go to: https://github.com/sarvind1119/pm-milap/actions
2. You should see a workflow run named **"Deploy to Azure App Service"**
3. If it already ran and failed (because the secret wasn't set up yet):
   - Click the failed run
   - Click **`Re-run jobs`** → **`Re-run all jobs`**
4. Wait **3–5 minutes** for it to complete (green ✅)

If you made code changes, just push to `main` — it triggers automatically.

---

### 4.2 — Verify the App is Live

1. **Open the app:** https://pm-milap.azurewebsites.net

   > 💡 On the **Free (F1) tier**, the app sleeps after 20 minutes of inactivity.
   > The first request after sleep takes ~30 seconds. This is normal — just wait.

2. **Log in** with any demo account (password for all: `demo1234`):

   | Role | Email |
   |---|---|
   | Admin | `admin@pmmilap.gov.in` |
   | Beneficiary | `ramesh.yadav@pmvikas.demo` |
   | Employer | `hr@bharatfab.com` |
   | Overseas Agent | `gulf@skybridge-overseas.com` |
   | Training Institute | `rajasthan.iti@pmmilap.gov.in` |

3. **Test the AI assistant** — click the chat bubble and ask something. If LLM is
   connected, you'll get an AI response. If not, you'll get a deterministic fallback
   (the app still works).

4. **Check live logs** — Azure portal → App Service → **Monitoring → Log stream**
   Look for:
   ```
   PM-MILAP portal running
   → http://localhost:3000
   LLM: llama-3.1-8b-instant @ https://api.groq.com/openai/v1
   [scheduler] matching pass: ...
   ```

---

## Part 5 — Ongoing Usage

### How to Redeploy After Code Changes

Just push to the `main` branch:
```bash
git add .
git commit -m "your change"
git push origin main
```
GitHub Actions will automatically redeploy in ~3-5 minutes.

### How to Manually Trigger a Deployment

Go to https://github.com/sarvind1119/pm-milap/actions → click **"Deploy to Azure App Service"** → **"Run workflow"** → **"Run workflow"**.

### How to View Application Logs

Azure portal → App Service **`pm-milap`** → **Monitoring** → **Log stream**

### How to Update an Environment Variable

1. Azure portal → App Service → **Settings** → **Environment variables**
2. Edit the value → **Apply** → **Save** → **Confirm**
3. The app restarts automatically with the new value

### How to Upgrade to Basic (B1) Tier

If the app is slow or hitting the 60 CPU-min/day Free tier limit:
1. App Service → **Settings** → **Scale up (App Service plan)**
2. Select **Basic B1** (~$13/month)
3. Click **Select**

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| GitHub Actions fails with "publish profile" error | Secret not set or expired | Re-download publish profile, update the `AZURE_WEBAPP_PUBLISH_PROFILE` secret |
| App loads but shows errors / blank page | Missing environment variables | Check App Settings in Azure — ensure all 12 are set and saved |
| "Application Error" on the app URL | Startup crash | Check Log stream for the actual error |
| AI chat doesn't respond intelligently | Wrong or missing `LLM_API_KEY` | Verify the Groq key in App Settings; check Log stream for LLM errors |
| App resets data after each deployment | `DATA_DIR` not set | Ensure `DATA_DIR=/home/data` is in Application Settings |
| "Basic authentication is disabled" | Azure policy restriction | Use Method B (Service Principal) from Part 3 |
| First page load takes 30 seconds | App was asleep (F1 free tier) | Normal behaviour; upgrade to B1 if unacceptable |
| `npm install` fails during deployment | Missing `SCM_DO_BUILD_DURING_DEPLOYMENT` | Ensure it's set to `true` in Application Settings |

---

## Architecture Summary

```
GitHub (main branch)
       │  push
       ▼
GitHub Actions (.github/workflows/azure-deploy.yml)
       │  zip deploy
       ▼
Azure App Service (pm-milap, Linux, Node 22 LTS)
       │  npm start → node server.js
       ├── Express API  (/api/*)
       ├── Static SPA   (public/)
       ├── SQLite DB    (/home/data/pm-milap.sqlite)  ← persistent
       └── Groq LLM     (api.groq.com)                ← external
```

**Public URL:** https://pm-milap.azurewebsites.net
