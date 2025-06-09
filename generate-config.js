const fs = require('fs');
const exchange = '/.netlify/functions/exchange';
const llmProxy = '/.netlify/functions/llm-proxy';
const content = `window.EXCHANGE_URL = "${exchange}";\nwindow.LLM_PROXY_URL = "${llmProxy}";\n`;
fs.writeFileSync('config.js', content);
