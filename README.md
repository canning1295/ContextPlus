# ContextPlus

A simple client-side web app to browse and copy files from your GitHub repositories. It uses GitHub OAuth for authentication and stores repository data in IndexedDB.

## Development

1. Set `window.GITHUB_CLIENT_ID` (or replace `YOUR_CLIENT_ID` in `app.js`) with
   your GitHub OAuth App client ID.
2. Provide an endpoint at `EXCHANGE_URL` that exchanges OAuth codes for access tokens.
   This repository now includes a small Node server (`server.js`) you can run locally:

   ```bash
   npm install
   GITHUB_CLIENT_ID=<your_id> GITHUB_CLIENT_SECRET=<your_secret> node server.js
   ```

The server hosts the static files and exposes `/api/exchange` used by the OAuth
flow. See [docs/GITHUB_OAUTH.md](docs/GITHUB_OAUTH.md) for full setup details.
3. Open `http://localhost:3000` in your browser to use the app.

### Deploying on Netlify

1. Create environment variables `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in
   your Netlify site settings.
2. Deploy the repository. Netlify runs `generate-config.js` which writes
   `config.js` using those variables and exposes a serverless function at
   `/.netlify/functions/exchange`.
3. Set your GitHub OAuth App callback URL to your Netlify site URL.

## Usage

- Click the settings gear to connect your GitHub account.
- Select a repository and branch from the modal in the top-left.
- Choose files or folders in the tree and press **Copy Selected** to place their contents on the clipboard.

Token counts in the toast are approximated by characters/4.7.
