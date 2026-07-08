/**
 * Single source of truth for the Google Sheets schema this backend reads/writes.
 * Reverse-engineered from the n8n workflow exports — see kamash migration plan.
 */

export const SPREADSHEET_ID = "1i52aS_uM8prV6ODSx8PkzO3tUMEnZbo1I1a1azoQe8s";
export const CONFIG_SPREADSHEET_ID = "1EwcZ-GGSWM3EOyXaFSAHA07UC7-dm-CSCiFTLVWsW-c";

export const DRIVE_ROOT_FOLDER_ID = "1McvYAEu97nBufa4po3gxfx6eiOdjmUzH";

export interface SheetRef {
  spreadsheetId: string;
  name: string;
}

export const SHEETS = {
  DIAGNOSES: {
    spreadsheetId: SPREADSHEET_ID,
    name: "אבחונים",
  } satisfies SheetRef,
  VERSIONS: {
    spreadsheetId: SPREADSHEET_ID,
    name: "גרסאות אבחון",
  } satisfies SheetRef,
  PARENT_QUESTIONNAIRES: {
    spreadsheetId: SPREADSHEET_ID,
    name: "שאלוני הורים",
  } satisfies SheetRef,
};

export const CONFIG_SHEETS = {
  GENERAL_RULES: {
    spreadsheetId: CONFIG_SPREADSHEET_ID,
    name: "כללי לשון",
  } satisfies SheetRef,
  SECTION_INSTRUCTIONS: {
    spreadsheetId: CONFIG_SPREADSHEET_ID,
    name: "גיליון1",
  } satisfies SheetRef,
};

/** Column name constants — kept as plain strings (not enums) since these are literal
 * Hebrew header cells read at runtime; typos here would silently fail to match. */
export const DIAGNOSES_COLUMNS = {
  TIMESTAMP: "חותמת זמן",
  DIAGNOSIS_DATE: "תאריך אבחון",
  PATIENT_NAME: "שם המאובחן",
  AGE: "גיל",
  SCHOOL: "מקום לימודים",
  GRADE: "כיתה",
  CITY: "עיר מגורים",
  RECORDING_FILE: "קובץ הקלטה",
  TRANSCRIPT_FILE: "קובץ תמלול",
  FOLDER: "תיקיה",
  JOB_ID: "jobid",
  STATUS: "status",
  ID_NUMBER: "תעודת זהות",
  EMAIL: "כתובת מייל לשליחת אבחון",
  SEGMENTED: "חלוקה למקטעים",
  LATEST_VERSION: "גרסא אחרונה",
  LATEST_VERSION_HTML: "גרסא אחרונה html",
} as const;

export const VERSIONS_COLUMNS = {
  JOB_ID: "jobid",
  VERSION: "version",
  CONTENT: "content",
} as const;

export const PARENT_QUESTIONNAIRES_COLUMNS = {
  NAME: "שם",
  ID_NUMBER: "ת.ז.",
  AGE: "גיל",
  GRADE: "כיתה",
  SCHOOL: "מקום לימודים",
  CITY: "עיר",
  STATUS: "סטטוס",
  DATE: "תאריך",
  CLOSED_FORM: "טופס סגור",
} as const;

export const SECTION_INSTRUCTIONS_COLUMNS = {
  SECTION_KEY_EN: "שם הסעיף באנגלית",
  SECTION_TITLE_HE: "שם הסעיף בעברית",
  EDITING_INSTRUCTIONS: "הוראות עריכה",
  FORMATTING_INSTRUCTIONS: "הוראות עיצוב",
} as const;

export const GENERAL_RULES_COLUMNS = {
  RULE_TYPE: "סוג הכלל",
  DETAILS: "פירוט",
} as const;

export const DiagnosisStatus = {
  PROCESSING: "processing",
  PROCESSING2: "processing2",
  DONE: "done",
  FAILED: "failed",
} as const;

export type DiagnosisStatusValue = (typeof DiagnosisStatus)[keyof typeof DiagnosisStatus];

export const ParentQuestionnaireStatus = {
  PENDING: "בהמתנה",
  COMPLETED: "הושלם",
} as const;
