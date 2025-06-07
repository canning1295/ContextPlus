exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const { code } = JSON.parse(event.body || '{}');
  if (!code) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing code' }) };
  }
  try {
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.REDIRECT_URI || event.headers['origin'] || ''
    });
    const resp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      body: params,
      headers: { Accept: 'application/json' }
    });
    const data = await resp.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error('Error exchanging code', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Exchange failed' }) };
  }
};
