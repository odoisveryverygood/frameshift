// Treat runner/proxy errors as errors, including HTML pages and empty responses.
export async function readApiResponse(response) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch {
    const content = (response.headers?.get('content-type') || '').toLowerCase();
    const html = content.includes('text/html') || /^\s*</.test(text);
    if (!response.ok) throw Error(html ? `The runner returned an error page (${response.status}). Check that the backend is running.` : text.trim().slice(0, 240) || `Request failed (${response.status}).`);
    throw Error('The runner returned an unexpected response instead of JSON. Check the backend connection.');
  }
  if (!response.ok) throw Error(typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : `Request failed (${response.status}).`);
  if (!data || typeof data !== 'object') throw Error('The runner returned an empty or invalid response.');
  return data;
}
export async function requestApi(path, body, options = {}) {
  let response;
  try {
    response = await fetch('/api' + path, {
      ...options,
      ...(body === undefined ? {} : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        body: JSON.stringify(body),
      }),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw Error('Cannot reach the runner. Check that the local backend is running.');
  }
  return readApiResponse(response);
}
