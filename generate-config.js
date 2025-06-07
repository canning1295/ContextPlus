const fs = require('fs');
const clientId = process.env.GITHUB_CLIENT_ID || 'YOUR_CLIENT_ID';
const exchange = process.env.EXCHANGE_URL || '/.netlify/functions/exchange';
const content = `window.GITHUB_CLIENT_ID = "${clientId}";\nwindow.EXCHANGE_URL = "${exchange}";\n`;
fs.writeFileSync('config.js', content);
