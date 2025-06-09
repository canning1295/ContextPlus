exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { provider, model, prompt, apiKey } = JSON.parse(event.body || '{}');
    if (!provider || !apiKey || !prompt) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing parameters' }) };
    }
    console.log('LLM proxy request', { provider, model });
    let url;
    let body;
    let headers = { 'Content-Type': 'application/json' };
    if (provider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      body = JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You generate detailed descriptions of project files.' },
          { role: 'user', content: prompt }
        ]
      });
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      body = JSON.stringify({
        model: model || 'claude-3-haiku-20240307',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024
      });
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider === 'google') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-pro'}:generateContent?key=${apiKey}`;
      body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown provider' }) };
    }
    const resp = await fetch(url, { method: 'POST', headers, body });
    const data = await resp.text();
    console.log('LLM proxy upstream status', resp.status);
    if (!resp.ok) {
      console.error('LLM proxy upstream error', resp.status, data);
      return { statusCode: resp.status, body: data };
    }
    return {
      statusCode: resp.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: data
    };
  } catch (err) {
    console.error('LLM proxy error', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Proxy failed', message: err.message }) };
  }
};
