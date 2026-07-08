import { Readable } from "node:stream";
import { getDriveClient } from "./googleAuth.js";
import { buildFileLink } from "../lib/driveLinks.js";

export interface UploadedFile {
  fileId: string;
  link: string;
}

export async function uploadText(
  folderId: string,
  filename: string,
  content: string,
  mimeType = "text/plain",
): Promise<UploadedFile> {
  const drive = getDriveClient();
  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [folderId], mimeType },
    media: { mimeType, body: Readable.from([content]) },
    fields: "id",
  });
  const fileId = data.id;
  if (!fileId) {
    throw new Error(`Drive did not return a file id for upload "${filename}"`);
  }
  return { fileId, link: buildFileLink(fileId) };
}
