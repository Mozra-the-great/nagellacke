import { loadSyncConfig } from '../useAppData';

function authHeaders(): Record<string, string> {
  const apiKey = localStorage.getItem('nagellacke_v3_apikey');
  if (apiKey) return { 'X-Api-Key': apiKey };
  const cfg = loadSyncConfig();
  if (cfg?.serverToken) return { 'Authorization': `Bearer ${cfg.serverToken}` };
  return {};
}

/**
 * The photo endpoints require either an admin API key or a server-sync JWT
 * (see requireApiKeyOrJwt on the server) - mirrors authHeaders() so the UI can
 * gate the upload button instead of letting it fail with a raw 401.
 */
export function hasPhotoUploadAuth(): boolean {
  if (localStorage.getItem('nagellacke_v3_apikey')) return true;
  const cfg = loadSyncConfig();
  return !!(cfg?.provider === 'server' && cfg.serverToken);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadPhoto(file: File): Promise<string> {
  const data = await fileToBase64(file);
  const res = await fetch('/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ data, mimeType: file.type }),
  });
  if (!res.ok) throw new Error(`Upload fehlgeschlagen (${res.status})`);
  const json = await res.json() as { filename: string };
  return json.filename;
}

export async function deletePhoto(filename: string): Promise<void> {
  await fetch(`/api/photos/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}
