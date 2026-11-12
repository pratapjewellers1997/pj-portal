// Talks to the Apps Script API.
// POST with text/plain keeps it a "simple" request, so the browser
// sends no CORS preflight (Apps Script cannot answer one).

const API_URL = import.meta.env.VITE_API_URL;

export async function callApi(action, payload = {}) {
  if (!API_URL) throw new Error('config_missing');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('network_error');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'server_error');
  return data;
}
