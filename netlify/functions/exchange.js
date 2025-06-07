exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const { code, client_id, client_secret } = JSON.parse(event.body || '{}');
  if (!code || !client_id || !client_secret) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing parameters' }) };
  }
  console.log('Exchange function body', { code, client_id });
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
    console.log('Exchange function response', data);
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
