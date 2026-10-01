// Shared response types used by the Overskill partner API adapter.
// Partner integration guide: https://www.overskill.com/developers/partners

export interface OverskillResult<T = unknown> {
  ok: boolean;
  status: number;
  json: T;
  /** true when this response came from the in-memory demo engine, not a live API. */
  mocked?: boolean;
}

export interface ProvisionResponse {
  team: {
    id: number;
    name: string;
    subscription_tier: string;
    credit_tier: string;
    created_at: string;
  };
  user_added: boolean;
  warning?: string | null;
  user_provisioned?: boolean;
  creator?: { id: number; external_creator_id: string };
  replayed?: boolean;
  /** Local adapter state; raw credentials are never returned to the browser. */
  recoveryRequired?: boolean;
  api_key: {
    id?: number;
    key: string | null;
    name: string;
    scope: string;
    note: string;
    recovery_required?: boolean;
  } | null;
}

export interface GenerateResponse {
  job_id: string | null;
  app_id: string;
  message_id: number;
  status: string;
  estimated_time_seconds: number;
  webhook_events: string[];
  status_url: string;
  app_url: string;
  // Present only when the OverSkill partner-context branch is deployed.
  partner_context?: { applied: boolean; bytes: number; truncated: boolean };
}

export type GenerationStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface AppSummary {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  visibility?: string;
  ai_model?: string | null;
  preview_url?: string | null;
  production_url?: string | null;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
  // Present only when the OverSkill white-label branch is deployed.
  white_label?: WhiteLabel | null;
}

export interface StatusResponse {
  job_id: string | null;
  app_id: string;
  status: GenerationStatus;
  progress: number;
  message: string | null;
  app: AppSummary | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface DeployResponse {
  deployment_id: number;
  status: string;
  message: string;
  production_url?: string | null;
  white_label?: WhiteLabel | null;
}

export interface WhiteLabel {
  partner: string;
  display_name: string;
  powered_by: string;
  show_attribution: boolean;
}

// Partner chat transcript for the white-label chat-left pane.
export interface FlowTool {
  name: string | null;
  status: string | null;
}
export interface FlowBlock {
  type: "message" | "tools";
  content?: string;
  status?: string | null;
  tools?: FlowTool[];
  timestamp?: string | null;
}
export interface ChatMessage {
  id: number;
  role: string;
  status: string | null;
  thinking_status: string | null;
  content: string;
  flow: FlowBlock[];
  created_at: string | null;
  updated_at: string | null;
}
export interface MessagesResponse {
  job_id: string;
  app_id: string;
  status: string;
  messages: ChatMessage[];
  app: AppSummary | null;
}

export interface ApiError {
  error: string;
  message?: string;
  reason?: string;
  fix?: string;
  command?: string;
  next_steps?: string[];
  [k: string]: unknown;
}
