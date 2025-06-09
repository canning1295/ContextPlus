# ContextPlus

A simple client-side web app to browse and copy files from your GitHub repositories. It is hosted at <https://contextplus.netlify.app/> and stores data locally using IndexedDB.

## Deploying on Netlify

Simply deploy this repository. Netlify runs `generate-config.js` which writes `config.js` and exposes a serverless function at `/.netlify/functions/exchange`.

## Usage

- Open the settings gear and follow the on-screen instructions to create an OAuth App with `https://contextplus.netlify.app/` as the callback URL.
- Enter your GitHub OAuth **Client ID** and **Client Secret**, then click **Connect GitHub** to authorize the app.
- Select a repository and branch from the modal in the top-left.
- Choose files or folders in the tree and press **Copy Selected** to place their contents on the clipboard.

### File Descriptions via LLM

Use **Generate Descriptions** in the File Descriptions column to have an LLM analyze each file and produce detailed summaries. Configure your preferred provider and API key under **Settings → LLM API**. Requests can run asynchronously or sequentially depending on your choice.

Token counts in the toast are approximated by characters/4.7.
