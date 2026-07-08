import { v4 as uuidv4 } from "uuid";

/** Replaces n8n's `$execution.id` as the jobid source. */
export function generateJobId(): string {
  return uuidv4();
}
