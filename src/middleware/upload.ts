import multer from "multer";

// Shared across every endpoint that accepts file uploads (sendEmailWithDiagnosis's PDF
// attachment, step1's audio recording). Memory storage is simple and fine at this volume;
// revisit if very large recordings become common.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // matches the frontend's 100MB audio cap
});
