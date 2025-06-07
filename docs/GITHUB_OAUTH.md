# GitHub OAuth Setup

This project uses GitHub OAuth to access private repositories. The app is hosted at <https://contextplus.netlify.app/> and each user provides their own OAuth credentials which are stored locally in IndexedDB. A Netlify serverless function performs the code/token exchange.

## Register an OAuth App
1. Sign in to GitHub and navigate to **Settings → Developer settings → OAuth Apps**.
2. Click **New OAuth App** and register the application.
   - **Authorization Callback URL** must be `https://contextplus.netlify.app/`.
3. After creation, note the **Client ID** and generate a **Client Secret**.

## Flow Overview
1. The app redirects the user to GitHub's authorization URL containing your Client ID, redirect URI, scopes and a random state string.
2. GitHub redirects back with an authorization code.
3. The code must be exchanged for an access token. Browsers cannot call GitHub's token endpoint directly, so a serverless function receives your Client ID and Secret and performs the exchange.
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
Open the settings modal on first visit and enter your Client ID and Client Secret. The app stores them securely in your browser and uses the built-in Netlify function at `/.netlify/functions/exchange` to obtain an access token.


