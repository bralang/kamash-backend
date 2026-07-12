/** The structured extraction produced by openaiService.segmentToJson — the n8n schema
 * minus personal_details, which is now built deterministically from the intake form. */
export interface SegmentedDiagnosis {
  referral_reason: string;
  general_impression: string;
  diagnosis_findings: string;
  difficulties: string;
  work_plan: string;
  summary_and_recommendations: string;
  home_practice: string;
  goals: string;
  external_treatments: string;
}

export interface PatientIntake {
  name: string;
  age: string;
  school: string;
  grade: string;
  city: string;
  date: string;
}
