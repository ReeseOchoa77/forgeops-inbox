export type EmailCategory =
  | "ACTIONABLE_REQUEST"
  | "FYI_UPDATE"
  | "SALES_MARKETING"
  | "SUPPORT_CUSTOMER_ISSUE"
  | "RECRUITING_HIRING"
  | "INTERNAL_COORDINATION"
  | "NEEDS_REVIEW";

export type PriorityLevel = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface ExtractedTask {
  title: string | null;
  summary: string | null;
  assigneeGuess: string | null;
  dueDate: string | null;
  confidence: number;
}

export interface EmailExtraction {
  category: EmailCategory | null;
  summary: string | null;
  priority: PriorityLevel | null;
  labelHints: string[];
  categoryHints: string[];
  containsActionRequest: boolean;
  task: ExtractedTask | null;
  confidence: number;
}
