export interface WorkerEndpoint {
  host: string;
  port: number;
}

export type WorkerConnectionState = 'connected' | 'idle' | 'busy' | 'disconnected' | 'unknown';

export interface WorkerStatus {
  host: string;
  port: number;
  status: WorkerConnectionState;
  containerRunning: boolean;
}

export interface WorkerEditDraft {
  host: string;
  port: string;
}
