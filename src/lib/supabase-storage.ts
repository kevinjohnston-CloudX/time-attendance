const BUCKET = "documents";

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return { url, key };
}

/**
 * Upload a file to the private documents bucket.
 * @param path  Storage path, e.g. "{tenantId}/{employeeId}/{uuid}.pdf"
 * @param file  The File object from FormData
 * @param contentType  MIME type of the file
 */
export async function uploadToStorage(
  path: string,
  file: File,
  contentType: string
): Promise<void> {
  const { url, key } = getConfig();
  const body = await file.arrayBuffer();

  const res = await fetch(
    `${url}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": contentType,
        "x-upsert": "false",
      },
      body,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Storage upload failed (${res.status}): ${text}`);
  }
}

/**
 * Generate a 1-hour signed download URL for a private file.
 */
export async function createSignedUrl(path: string): Promise<string> {
  const { url, key } = getConfig();

  const res = await fetch(
    `${url}/storage/v1/object/sign/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to generate signed URL (${res.status}): ${text}`);
  }

  const data = await res.json() as { signedURL: string };
  return `${url}/storage/v1${data.signedURL}`;
}

/**
 * Delete a file from the private documents bucket.
 * Errors are logged but not re-thrown — callers decide how to handle.
 */
export async function deleteFromStorage(path: string): Promise<void> {
  const { url, key } = getConfig();

  const res = await fetch(
    `${url}/storage/v1/object/${BUCKET}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: [path] }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    console.error(`Storage delete failed for "${path}" (${res.status}): ${text}`);
  }
}
