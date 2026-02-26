/** ADP Workforce Now API response types */

export interface AdpWorker {
  workerID: { idValue: string };
  workerStatus: {
    statusCode: { codeValue: string }; // "Active", "Terminated", etc.
    effectiveDate?: string;
  };
  workerDates: {
    originalHireDate?: string; // "YYYY-MM-DD"
    terminationDate?: string;
  };
  person: {
    legalName: {
      givenName: string;
      familyName1: string;
      middleName?: string;
    };
    communication?: {
      emails?: Array<{ emailUri: string; nameCode?: { codeValue: string } }>;
    };
  };
  businessCommunication?: {
    emails?: Array<{ emailUri: string }>;
  };
  homeOrganizationalUnits?: Array<{
    nameCode: { codeValue: string; shortName?: string };
    typeCode: { codeValue: string }; // "Department", "Location", etc.
  }>;
  assignedOrganizationalUnits?: Array<{
    nameCode: { codeValue: string; shortName?: string };
    typeCode: { codeValue: string };
  }>;
  workerAssignment?: {
    positionID?: string;
    jobTitle?: string;
  };
}

export interface AdpWorkersResponse {
  workers: AdpWorker[];
  meta?: {
    totalCount?: number;
  };
}

export interface AdpTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface AdpConfig {
  clientId: string;
  clientSecret: string;
  certBase64: string;
  keyBase64: string;
  apiUrl: string;
  tokenUrl: string;
}

// ─── Payroll Push Types ───────────────────────────────────────────────────────

/** A single earning entry for one worker in a pay data batch. */
export interface AdpEarningEntry {
  associateOID: string;
  earningCode: string; // "R" (regular), "O" (overtime), etc.
  hoursValue: number; // decimal hours, e.g. 40.0
}

/** ADP's event-based payload for the pay-data-input API. */
export interface AdpPayDataEvent {
  data: {
    eventContext: {
      worker: { associateOID: string };
    };
    transform: {
      payDataInput: {
        payeePayInputs: Array<{
          payrollProfilePayInputs: Array<{
            payInputs: Array<{
              earningInputs: Array<{
                earningCode: { codeValue: string };
                numberOfHours: { hoursValue: number };
              }>;
            }>;
          }>;
        }>;
      };
    };
  };
}

export interface AdpPayDataRequest {
  events: AdpPayDataEvent[];
}

/**
 * Map our PayBucket enum to ADP earning codes.
 * These are defaults — actual codes depend on the client's ADP configuration.
 * Adjust once connected to real ADP instance.
 */
export const PAY_BUCKET_TO_ADP_CODE: Record<string, string> = {
  REG: "R",
  OT: "O",
  DT: "D",       // Some ADP setups use a custom code for double-time
  PTO: "V",      // Vacation
  SICK: "S",
  HOLIDAY: "H",
  FMLA: "FM",
  BEREAVEMENT: "BR",
  JURY_DUTY: "JD",
  MILITARY: "ML",
};
