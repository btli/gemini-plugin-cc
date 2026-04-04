export interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface NewSessionParams {
  cwd: string;
  mcpServers?: unknown[];
}

export interface NewSessionResult {
  sessionId: string;
}

export interface LoadSessionParams {
  sessionId: string;
  cwd: string;
}

export interface PromptParams {
  sessionId: string;
  prompt: Array<{ type: "text"; text: string }>;
}

export interface PromptResult {
  stopReason: "end_turn" | "cancelled" | "error" | string;
}

export interface CancelParams {
  sessionId: string;
}

export interface SetModeParams {
  sessionId: string;
  modeId: "default" | "plan" | "auto_edit" | "yolo";
}

export interface SetModelParams {
  sessionId: string;
  modelId: string;
}

export type UpdateType =
  | "agent_message_chunk"
  | "tool_call"
  | "tool_call_update"
  | "current_mode_update"
  | "usage_update";

export interface SessionUpdateParams {
  sessionId: string;
  update: {
    sessionUpdate: UpdateType;
    content?: { type?: string; text?: string };
    name?: string;
    [key: string]: unknown;
  };
}

export interface RequestPermissionParams {
  sessionId: string;
  description: string;
}

export interface RequestPermissionResult {
  approved: boolean;
}

export interface ReadTextFileParams {
  path: string;
}

export interface ReadTextFileResult {
  content: string;
}

export interface WriteTextFileParams {
  path: string;
  content: string;
}

// --- Client classes ---

export type NotificationHandler = (message: JsonRpcNotification) => void;
export type ServerRequestHandler = (params: unknown) => Promise<unknown>;

export interface JsonRpcClient {
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; method: string }>;
  nextId: number;
  notificationHandler: NotificationHandler | null;
  serverRequestHandlers: Map<string, ServerRequestHandler>;
  closed: boolean;
  exitError: Error | null;
  exitPromise: Promise<void>;

  setNotificationHandler(handler: NotificationHandler | null): void;
  onServerRequest(method: string, handler: ServerRequestHandler): void;
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  handleLine(line: string): void;
  handleServerRequest(message: JsonRpcRequest): void;
  handleExit(error?: Error | null): void;
  sendMessage(message: unknown): void;
}

export interface GeminiAcpClient extends JsonRpcClient {
  readonly pid: number;
  readonly exited: boolean;
  stderr: string;
  close(opts?: { phase1Ms?: number; phase2Ms?: number }): Promise<void>;
}

// --- Lifecycle functions ---

export interface SpawnAcpClientOptions {
  binary?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
  write?: boolean;
  logFile?: string;
}

export interface CreateSessionOptions extends SpawnAcpClientOptions {
  modeId?: string;
  model?: string;
}

export interface CreateSessionResult {
  client: GeminiAcpClient;
  sessionId: string;
}
