const fs = require('fs');
const exchange = '/.netlify/functions/exchange';
const content = `window.EXCHANGE_URL = "${exchange}";\n`;
fs.writeFileSync('config.js', content);
