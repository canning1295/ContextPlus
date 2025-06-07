# ContextPlus

A simple client-side web app to browse and copy files from your GitHub repositories. It uses GitHub OAuth for authentication and stores repository data in IndexedDB.

## Development

1. Replace `YOUR_CLIENT_ID` in `app.js` with your GitHub OAuth App client ID.
2. Provide an endpoint at `EXCHANGE_URL` that exchanges OAuth codes for access tokens.
3. Serve the files with any static server.

## Usage

- Click the settings gear to connect your GitHub account.
- Select a repository and branch from the modal in the top-left.
- Choose files or folders in the tree and press **Copy Selected** to place their contents on the clipboard.

Token counts in the toast are approximated by characters/4.7.
