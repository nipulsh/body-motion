export type MeshyRemoteStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export interface MeshyCreateTaskResponse {
  result: string;
}

export interface MeshyTaskError {
  message?: string;
}

export interface MeshyMultiImageTask {
  id: string;
  type: string;
  status: MeshyRemoteStatus;
  progress: number;
  model_urls?: {
    glb?: string;
  };
  task_error?: MeshyTaskError;
}

export interface MeshyRiggingTask {
  id: string;
  type: string;
  status: MeshyRemoteStatus;
  progress: number;
  result?: {
    rigged_character_glb_url?: string;
  };
  task_error?: MeshyTaskError;
}
