const express = require('express');
const path = require('path');

const app = express();
const DEBUG = true;
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

async function handleExchange(req, res) {
  if(DEBUG) console.log('Exchange request body', req.body);
  const { code, client_id, client_secret } = req.body;
  if (!code || !client_id || !client_secret) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  try {
    const params = new URLSearchParams({
      client_id,
      client_secret,
      code,
      redirect_uri: 'https://contextplus.netlify.app/'
    });
    const resp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      body: params,
      headers: { Accept: 'application/json' }
    });
    const data = await resp.json();
    if(DEBUG) console.log('Exchange response', data);
    res.json(data);
  } catch (err) {
    console.error('Error exchanging code', err);
    res.status(500).json({ error: 'Exchange failed' });
  }
}

// Support both the local "/api" path and the Netlify function path
app.post('/api/exchange', handleExchange);
app.post('/.netlify/functions/exchange', handleExchange);

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
