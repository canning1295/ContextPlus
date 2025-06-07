# ContextPlus

A simple client-side web app to browse and copy files from your GitHub repositories. It is hosted at <https://contextplus.netlify.app/> and stores data locally using IndexedDB.

## Development

To develop locally:

```bash
npm install
node server.js
```

Open `http://localhost:3000` in your browser. Each user supplies their own GitHub OAuth credentials inside the app.

### Deploying on Netlify

Simply deploy this repository. Netlify runs `generate-config.js` which writes `config.js` and exposes a serverless function at `/.netlify/functions/exchange`.

## Usage

- Click the settings gear and enter your GitHub OAuth **Client ID** and **Client Secret**.
- Follow the on-screen instructions to create an OAuth App with `https://contextplus.netlify.app/` as the callback URL.
- After saving your credentials, click **Connect GitHub** to authorize the app.
- Select a repository and branch from the modal in the top-left.
- Choose files or folders in the tree and press **Copy Selected** to place their contents on the clipboard.

Token counts in the toast are approximated by characters/4.7.
