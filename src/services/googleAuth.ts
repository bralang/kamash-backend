import { google } from "googleapis";
import { config } from "../config/env.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"];

let auth: InstanceType<typeof google.auth.GoogleAuth> | undefined;

function getAuth() {
  if (!auth) {
    auth = new google.auth.GoogleAuth({
      keyFile: config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      scopes: SCOPES,
    });
  }
  return auth;
}

// googleapis' TS types for `auth` are overly narrow against GoogleAuth's own generic
// (a known upstream friction point); the runtime behavior is correct, so cast here.
export function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() as never });
}

export function getDriveClient() {
  return google.drive({ version: "v3", auth: getAuth() as never });
}
