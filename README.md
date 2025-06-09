# ContextPlus

A simple client-side web app to browse and copy files from your GitHub repositories. It is hosted at <https://contextplus.netlify.app/> and stores data locally using IndexedDB.

## Deploying on Netlify

Simply deploy this repository. Netlify runs `generate-config.js` which writes `config.js` and exposes serverless functions:
`/.netlify/functions/exchange` for GitHub OAuth and `/.netlify/functions/llm-proxy` for LLM API calls.

**Note:** Browsers cannot call most LLM APIs directly because they lack the required CORS headers. The included `llm-proxy` function forwards requests to your provider and avoids these CORS issues. No keys are stored on the server – the proxy just relays your request.

## Usage

- Open the settings gear and follow the on-screen instructions to create an OAuth App with `https://contextplus.netlify.app/` as the callback URL.
- Enter your GitHub OAuth **Client ID** and **Client Secret**, then click **Connect GitHub** to authorize the app.
- Select a repository and branch from the modal in the top-left.
- Choose files or folders in the tree and press **Copy Selected** to place their contents on the clipboard.

### File Descriptions via LLM


Use **Generate Descriptions** in the File Descriptions column to have an LLM analyze each file and produce detailed summaries. Configure your preferred provider, model and API key under **Settings → LLM API**. Requests can run asynchronously or sequentially depending on your choice.
