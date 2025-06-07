# GitHub OAuth Setup

This project uses GitHub OAuth to access private repositories. The OAuth flow is handled entirely on the frontend with a small serverless token exchange.

## Register an OAuth App
1. Sign in to GitHub and navigate to **Settings → Developer settings → OAuth Apps**.
2. Click **New OAuth App** and register the application.
   - **Authorization Callback URL** should match your local dev URL (e.g. `http://localhost:3000`).
3. After creation, note the **Client ID** and generate a **Client Secret**.

## Flow Overview
1. The app redirects the user to GitHub's authorization URL containing your Client ID, redirect URI, scopes and a random state string.
2. GitHub redirects back with an authorization code.
3. The code must be exchanged for an access token. Browsers cannot call GitHub's token endpoint directly, so use a small proxy (e.g. serverless function) that stores your **Client Secret** and performs the exchange.
4. Use the returned token to request repository data via the GitHub API.
5. Repositories are cached in IndexedDB for quick access on subsequent visits.

A minimal proxy might look like:
```js
// pseudo serverless function
const params = new URLSearchParams({
  client_id: GITHUB_CLIENT_ID,
  client_secret: GITHUB_CLIENT_SECRET,
  code,
  redirect_uri: REDIRECT_URI
});
return fetch('https://github.com/login/oauth/access_token', {
  method: 'POST',
  body: params,
  headers: { 'Accept': 'application/json' }
});
```

## Client Configuration
Edit `app.js` and replace `YOUR_CLIENT_ID` with the Client ID from your OAuth app (or create `config.js` with `window.GITHUB_CLIENT_ID`). Set `EXCHANGE_URL` (or `window.EXCHANGE_URL`) to the URL of your token exchange proxy. A simple Node server (`server.js`) is provided in this repo and exposes `/api/exchange` when run with your credentials:

```bash
GITHUB_CLIENT_ID=<your_id> GITHUB_CLIENT_SECRET=<your_secret> node server.js
```

Without these values the "Connect GitHub" button will display an error toast.


