const ID_PATTERNS = [
  /\/folders\/([0-9a-zA-Z_-]+)/,
  /\/file\/d\/([0-9a-zA-Z_-]+)/,
  /[?&]id=([0-9a-zA-Z_-]+)/,
  /\/d\/([0-9a-zA-Z_-]+)/,
];

/** Extracts a Drive file/folder id from any of the link shapes this app writes
 * into Sheets (folder share links, file "/edit" links, etc). */
export function parseFileIdFromLink(link: string): string {
  for (const pattern of ID_PATTERNS) {
    const match = link.match(pattern);
    if (match) return match[1];
  }
  throw new Error(`Could not parse Drive file/folder id from link: ${link}`);
}

/** Builds the same link shape the original n8n workflows wrote for files
 * (e.g. גרסא אחרונה html), so downstream consumers (including humans opening
 * the sheet) see a consistent, clickable link format. */
export function buildFileLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/edit`;
}

export function buildFolderLink(folderId: string): string {
  return `https://drive.google.com/drive/u/0/folders/${folderId}`;
}
