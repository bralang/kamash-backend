import { Readable } from "node:stream";
import { getDriveClient } from "./googleAuth.js";
import { buildFileLink, buildFolderLink, parseFileIdFromLink } from "../lib/driveLinks.js";
import { DRIVE_ROOT_FOLDER_ID } from "../config/sheets.js";

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

export async function uploadBinary(
  folderId: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
): Promise<UploadedFile> {
  const drive = getDriveClient();
  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [folderId], mimeType },
    media: { mimeType, body: Readable.from([buffer]) },
    fields: "id",
  });
  const fileId = data.id;
  if (!fileId) {
    throw new Error(`Drive did not return a file id for upload "${filename}"`);
  }
  return { fileId, link: buildFileLink(fileId) };
}

/** Creates a native Google Doc from plain text — used for the raw/cleaned transcript
 * artifacts, matching n8n's "Create file from text" nodes with convertToGoogleDocument. */
export async function createDoc(folderId: string, title: string, content: string): Promise<UploadedFile> {
  const drive = getDriveClient();
  const { data } = await drive.files.create({
    requestBody: { name: title, parents: [folderId], mimeType: "application/vnd.google-apps.document" },
    media: { mimeType: "text/plain", body: Readable.from([content]) },
    fields: "id",
  });
  const fileId = data.id;
  if (!fileId) {
    throw new Error(`Drive did not return a file id for doc "${title}"`);
  }
  return { fileId, link: buildFileLink(fileId) };
}

/** Names the folder `${patientName} (${jobId prefix})` rather than just patientName —
 * fixes the collision risk from the n8n workflow, which named folders from patient name
 * alone. Nothing reads the folder *name*, only the *link* stored in the sheet, so this
 * is safe to change with no effect on any consumer. */
export async function createPatientFolder(patientName: string, jobId: string): Promise<UploadedFile> {
  const drive = getDriveClient();
  const name = `${patientName} (${jobId.slice(0, 8)})`;
  const { data } = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [DRIVE_ROOT_FOLDER_ID],
    },
    fields: "id",
  });
  const fileId = data.id;
  if (!fileId) {
    throw new Error(`Drive did not return a folder id for patient "${patientName}"`);
  }
  return { fileId, link: buildFolderLink(fileId) };
}

export async function downloadFileText(fileIdOrLink: string): Promise<string> {
  const fileId = fileIdOrLink.startsWith("http") ? parseFileIdFromLink(fileIdOrLink) : fileIdOrLink;
  const drive = getDriveClient();
  const { data } = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
  return data as unknown as string;
}
