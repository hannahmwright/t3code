import type {
  OrchestrationLatestTurn,
  OrchestrationProposedPlanId,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  ProjectScript as ContractProjectScript,
  ThreadId,
  ProjectId,
  WorkbookId,
  TurnId,
  MessageId,
  CheckpointRef,
  ProviderKind,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadGoalSnapshot,
} from "@t3tools/contracts";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "default";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectScript = ContractProjectScript;

export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
}

export interface ChatImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface VisualProofArtifact {
  id: string;
  kind: "image" | "video";
  mimeType: string;
  byteSize: number;
  filename: string;
  createdAt: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface VisualProofRun {
  runId: string;
  status: "started" | "step-captured" | "completed" | "failed";
  cwd: string | null;
  title: string;
  summary: string;
  artifacts: VisualProofArtifact[];
  posterArtifactId: string | null;
  videoArtifactId: string | null;
  stepCount: number;
  updatedAt: string;
}

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  text: string;
  turnId?: TurnId | null;
  attachments?: ChatAttachment[];
  createdAt: string;
  completedAt?: string | undefined;
  streaming: boolean;
}

export interface ProposedPlan {
  id: OrchestrationProposedPlanId;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnDiffFileChange {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TurnDiffSummary {
  turnId: TurnId;
  completedAt: string;
  status?: string | undefined;
  files: TurnDiffFileChange[];
  checkpointRef?: CheckpointRef | undefined;
  assistantMessageId?: MessageId | undefined;
  checkpointTurnCount?: number | undefined;
}

export interface Project {
  id: ProjectId;
  name: string;
  emoji: string | null;
  color: string | null;
  workbookId?: WorkbookId | null;
  groupName: string | null;
  groupEmoji: string | null;
  cwd: string;
  model: string;
  expanded: boolean;
  setAside?: boolean;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  scripts: ProjectScript[];
}

export interface Workbook {
  id: WorkbookId;
  name: string;
  emoji: string | null;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface Thread {
  id: ThreadId;
  codexThreadId: string | null;
  projectId: ProjectId | null;
  sidechatSourceThreadId?: ThreadId | null;
  title: string;
  model: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  session: ThreadSession | null;
  messages: ChatMessage[];
  proposedPlans: ProposedPlan[];
  detailsLoaded: boolean;
  error: string | null;
  createdAt: string;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  lastVisitedAt?: string | undefined;
  branch: string | null;
  worktreePath: string | null;
  goal?: ThreadGoalSnapshot | null;
  turnDiffSummaries: TurnDiffSummary[];
  activities: OrchestrationThreadActivity[];
}

export interface ThreadSession {
  provider: ProviderKind;
  status: SessionPhase | "error" | "closed";
  activeTurnId?: TurnId | undefined;
  canInterrupt?: boolean | undefined;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  orchestrationStatus: OrchestrationSessionStatus;
}
