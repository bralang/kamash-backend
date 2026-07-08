export interface PersonalDetails {
  name: string;
  age: string;
  grade: string;
  school: string;
  city: string;
  diagnosis_date: string;
}

/** The structured extraction produced by openaiService.segmentToJson — matches the
 * live-wired json_schema from n8n's "חלוקה לחלקי אבחון" node exactly. */
export interface SegmentedDiagnosis {
  personal_details: PersonalDetails;
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
