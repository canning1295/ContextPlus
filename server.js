const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.post('/api/exchange', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code' });
  try {
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.REDIRECT_URI || `${req.protocol}://${req.get('host')}`
    });
    const resp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      body: params,
      headers: { Accept: 'application/json' }
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error('Error exchanging code', err);
    res.status(500).json({ error: 'Exchange failed' });
  }
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
