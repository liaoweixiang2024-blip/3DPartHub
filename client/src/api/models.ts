import client from "./client";
import type { PaginatedResponse, PaginationParams } from "../types";

export interface ServerModelListItem {
  model_id: string;
  name: string;
  format: string;
  thumbnail_url: string | null;
  gltf_url: string | null;
  file_size: number;
  original_size: number;
  category?: string;
  category_id?: string | null;
  download_count?: number;
  created_at: string;
  drawing_url?: string | null;
  drawing_name?: string | null;
  drawing_size?: number | null;
  group?: {
    id: string;
    name: string;
    is_primary: boolean;
    variant_count: number;
  } | null;
}

export interface ModelVariant {
  model_id: string;
  name: string;
  thumbnail_url: string | null;
  original_name: string;
  original_size: number;
  is_primary: boolean;
  created_at: string;
}

export interface ModelGroupModel {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  originalName: string;
  originalSize: number;
  createdAt: string;
  fileModifiedAt?: string | null;
}

export interface ModelGroupItem {
  id: string;
  name: string;
  description: string | null;
  primary: {
    id: string;
    name: string;
    thumbnailUrl: string | null;
  } | null;
  model_count: number;
  models: ModelGroupModel[];
  created_at: string;
}

export interface ModelPreviewMeta {
  version: number;
  sourceName: string;
  sourceFormat?: string;
  unit?: string;
  totals?: {
    partCount: number;
    vertexCount: number;
    faceCount: number;
  };
  bounds?: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
    center: [number, number, number];
  };
  parts?: Array<{
    id: string;
    name: string;
    color: string | null;
    sourceMeshIndex?: number;
    vertexCount: number;
    faceCount: number;
    bounds: {
      min: [number, number, number];
      max: [number, number, number];
      size?: [number, number, number];
      center?: [number, number, number];
    };
  }>;
  tree?: Array<{ id: string; name: string; children: string[] }>;
  diagnostics?: {
    generatedAt: string;
    converter: string;
    tessellation?: Record<string, unknown>;
    sourceMeshCount?: number;
    validMeshCount?: number;
    skippedMeshCount?: number;
    conversionMs?: number;
    asset?: {
      gltfSize?: number;
      originalSize?: number;
      compressionRatio?: number | null;
    };
    optimization?: {
      indexComponentTypes?: {
        uint16?: number;
        uint32?: number;
      };
      indexBytesSaved?: number;
    };
    performance?: {
      level?: "normal" | "large" | "huge";
      hints?: string[];
    };
    warnings?: string[];
  };
}

export interface ServerModelDetail {
  model_id: string;
  name?: string;
  original_name: string;
  gltf_url: string | null;
  thumbnail_url: string | null;
  gltf_size: number;
  original_size: number;
  format: string;
  status: string;
  description?: string;
  category?: string;
  category_id?: string | null;
  created_at: string;
  file_modified_at?: string | null;
  drawing_url?: string | null;
  drawing_name?: string | null;
  drawing_size?: number | null;
  preview_meta?: ModelPreviewMeta | null;
  group?: {
    id: string;
    name: string;
    variants: ModelVariant[];
  } | null;
}

export interface ServerModelListResponse {
  total: number;
  items: ServerModelListItem[];
  page: number;
  page_size: number;
}

export type PreviewDiagnosticStatus = "ok" | "warning" | "invalid" | "missing";
export type PreviewDiagnosticFilter = PreviewDiagnosticStatus | "problem" | "all";

export interface ModelPreviewDiagnosticItem {
  model_id: string;
  name: string;
  original_name: string | null;
  format: string | null;
  thumbnail_url: string | null;
  gltf_url: string | null;
  original_size: number;
  category: string | null;
  created_at: string | null;
  preview_status: PreviewDiagnosticStatus;
  preview_label: string;
  preview_reason: string;
  asset_status?: PreviewDiagnosticStatus;
  asset_reason?: string;
  asset_size?: number;
  thumbnail_status?: PreviewDiagnosticStatus;
  thumbnail_reason?: string;
  thumbnail_size?: number;
  part_count: number;
  vertex_count: number;
  face_count: number;
  skipped_mesh_count: number;
  warnings: string[];
  bounds_size: [number, number, number] | null;
  converter: string | null;
  generated_at: string | null;
}

export interface ModelPreviewDiagnosticsResponse {
  summary: {
    total: number;
    ok: number;
    warning: number;
    invalid: number;
    missing: number;
    problem: number;
  };
  items: ModelPreviewDiagnosticItem[];
  total: number;
  page: number;
  page_size: number;
  status: PreviewDiagnosticFilter;
}

export interface ModelPreviewRebuildResponse {
  status: PreviewDiagnosticFilter;
  total_candidates: number;
  queued: number;
  skipped: number;
  failed: number;
  items: Array<{
    model_id: string;
    name: string;
    status: "queued" | "skipped" | "failed";
    reason?: string;
    job_id?: string | number;
  }>;
}

export type ConversionQueueState = "active" | "waiting" | "delayed" | "prioritized" | "waiting-children" | "completed" | "failed" | "paused" | "unknown";

export interface ConversionQueueJob {
  id: string;
  name: string;
  state: ConversionQueueState;
  progress: number;
  model_id: string | null;
  model_name: string;
  original_name: string | null;
  ext: string | null;
  rebuild_reason: string | null;
  attempts_made: number;
  failed_reason: string | null;
  timestamp: number | null;
  processed_on: number | null;
  finished_on: number | null;
  active_ms?: number;
  is_stale?: boolean;
}

export interface ConversionQueueResponse {
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
  };
  queue_counts?: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
  };
  items: ConversionQueueJob[];
  total: number;
  filter_state?: ConversionQueueState | "all";
  generated_at: string;
}

export interface ConversionQueueActionResponse {
  cancelled?: number;
  retried?: number;
  skipped?: number;
  failed?: number;
  active?: number;
  cleaned?: number;
  type?: "completed" | "failed";
  items?: Array<{
    id: string;
    model_id: string | null;
    status: "cancelled" | "retried" | "skipped" | "failed";
    reason?: string;
  }>;
  job_ids?: string[];
}

export interface ConversionQueueJobDetail extends ConversionQueueJob {
  stacktrace: string[];
  log_count: number;
  logs: string[];
  model: {
    id: string;
    name: string | null;
    status: string;
    originalName: string | null;
    format: string | null;
    gltfUrl: string | null;
    thumbnailUrl: string | null;
    updatedAt: string;
  } | null;
  data: {
    model_id: string | null;
    original_name: string | null;
    ext: string | null;
    preserve_source: boolean;
    rebuild_reason: string | null;
    source_path: string | null;
    source_name: string | null;
    source_exists: boolean | null;
  };
  result: unknown;
}

function mapListResponse(data: ServerModelListResponse): PaginatedResponse<ServerModelListItem> {
  return {
    items: data.items,
    total: data.total,
    page: data.page,
    pageSize: data.page_size,
    totalPages: Math.ceil(data.total / (data.page_size || 20)),
  };
}

export const modelApi = {
  list: async (params?: PaginationParams & { category?: string; categoryId?: string; search?: string; format?: string; grouped?: boolean; sort?: string }): Promise<PaginatedResponse<ServerModelListItem>> => {
    const { data: resp } = await client.get("/models", {
      params: {
        page: params?.page || 1,
        page_size: params?.pageSize || 50,
        search: params?.search || undefined,
        format: params?.format || undefined,
        category: params?.category || undefined,
        category_id: params?.categoryId || undefined,
        grouped: params?.grouped ?? true,
        sort: params?.sort || undefined,
      },
    });
    const inner = resp.data?.data ?? resp.data ?? resp;
    return mapListResponse(inner);
  },

  getById: async (id: string): Promise<ServerModelDetail> => {
    const { data: resp } = await client.get(`/models/${id}`);
    return resp.data?.data ?? resp.data ?? resp;
  },

  previewDiagnostics: async (params?: { status?: PreviewDiagnosticFilter; search?: string; page?: number; pageSize?: number }): Promise<ModelPreviewDiagnosticsResponse> => {
    const { data: resp } = await client.get("/models/preview-diagnostics", {
      params: {
        status: params?.status || "problem",
        search: params?.search || undefined,
        page: params?.page || 1,
        page_size: params?.pageSize || 12,
      },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  rebuildPreviewDiagnostics: async (data?: { status?: PreviewDiagnosticFilter; modelIds?: string[]; limit?: number; all?: boolean }): Promise<ModelPreviewRebuildResponse> => {
    const { data: resp } = await client.post("/models/preview-diagnostics/rebuild", {
      status: data?.status || "problem",
      modelIds: data?.modelIds,
      limit: data?.limit || 50,
      all: data?.all || undefined,
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  conversionQueue: async (params?: { limit?: number; state?: ConversionQueueState | "all" }): Promise<ConversionQueueResponse> => {
    const { data: resp } = await client.get("/tasks/conversion-queue", {
      params: { limit: params?.limit || 12, state: params?.state },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  conversionQueueJob: async (id: string): Promise<ConversionQueueJobDetail> => {
    const { data: resp } = await client.get(`/tasks/conversion-queue/${id}`);
    return resp?.success === true ? resp.data : resp;
  },

  retryFailedConversionJobs: async (data?: { jobIds?: string[]; limit?: number }): Promise<ConversionQueueActionResponse> => {
    const { data: resp } = await client.post("/tasks/conversion-queue/retry-failed", {
      jobIds: data?.jobIds,
      limit: data?.limit || 25,
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  cancelPreviewRebuildJobs: async (data?: { limit?: number }): Promise<ConversionQueueActionResponse> => {
    const { data: resp } = await client.post("/tasks/conversion-queue/cancel-rebuilds", {
      limit: data?.limit || 10000,
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  cleanConversionQueue: async (data: { type: "completed" | "failed"; graceMs?: number; limit?: number }): Promise<ConversionQueueActionResponse> => {
    const { data: resp } = await client.post("/tasks/conversion-queue/clean", {
      type: data.type,
      graceMs: data.graceMs ?? 0,
      limit: data.limit || 100,
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`/models/${id}`);
  },

  update: async (id: string, data: { name?: string; description?: string; categoryId?: string | null }): Promise<ServerModelDetail> => {
    const { data: resp } = await client.put(`/models/${id}`, data);
    return resp.data?.data ?? resp.data ?? resp;
  },

  upload: async (file: File, options?: { categoryId?: string }): Promise<{ model_id: string; status: string }> => {
    const form = new FormData();
    form.append("file", file);
    if (options?.categoryId) form.append("categoryId", options.categoryId);
    if (file.lastModified) form.append("lastModified", String(file.lastModified));
    const { data: resp } = await client.post("/models/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  reconvert: async (id: string): Promise<{ model_id: string; gltf_size: number; thumbnail_url: string; preview_meta?: ModelPreviewMeta | null }> => {
    const { data: resp } = await client.post(`/models/${id}/reconvert`);
    return resp.data?.data ?? resp.data ?? resp;
  },

  replaceFile: async (id: string, file: File): Promise<{ model_id: string; status: string }> => {
    const form = new FormData();
    form.append("file", file);
    if (file.lastModified) form.append("lastModified", String(file.lastModified));
    const { data: resp } = await client.post(`/models/${id}/replace-file`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  reconvertAll: async (): Promise<{ total: number; success: number; failed: number }> => {
    const { data: resp } = await client.post("/models/reconvert-all");
    return resp.data?.data ?? resp.data ?? resp;
  },

  uploadThumbnail: async (id: string, file: File): Promise<{ model_id: string; thumbnail_url: string }> => {
    const form = new FormData();
    form.append("file", file);
    const { data: resp } = await client.post(`/models/${id}/thumbnail`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  uploadDrawing: async (id: string, file: File): Promise<{ model_id: string; drawing_url: string }> => {
    const form = new FormData();
    form.append("file", file);
    const { data: resp } = await client.post(`/models/${id}/drawing`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return resp.data?.data ?? resp.data ?? resp;
  },

  deleteDrawing: async (id: string): Promise<void> => {
    await client.delete(`/models/${id}/drawing`);
  },

  getMergeSuggestions: async (params?: { page?: number; pageSize?: number }): Promise<{ data: { name: string; count: number; models: { id: string; name: string; thumbnailUrl: string | null; originalName: string; originalSize: number; createdAt: string }[] }[]; total: number }> => {
    const { data: resp } = await client.get("/model-groups/suggestions", {
      params: { page: params?.page || 1, page_size: params?.pageSize || 20 },
    });
    const inner = resp.data?.data ?? resp.data;
    return { data: Array.isArray(inner) ? inner : [], total: resp.data?.total ?? resp.total ?? 0 };
  },

  batchMerge: async (items: { name: string; modelIds: string[] }[]): Promise<{ merged: number }> => {
    const { data: resp } = await client.post("/model-groups/batch-merge", { items });
    const inner = resp.data?.data ?? resp.data ?? resp;
    return inner;
  },

  listModelGroups: async (): Promise<ModelGroupItem[]> => {
    const { data: resp } = await client.get("/model-groups");
    return resp.data?.data ?? resp.data ?? resp;
  },

  updateModelGroup: async (id: string, data: { name?: string; description?: string | null; primaryId?: string | null }): Promise<ModelGroupItem> => {
    const { data: resp } = await client.put(`/model-groups/${id}`, data);
    return resp.data?.data ?? resp.data ?? resp;
  },

  deleteModelGroup: async (id: string): Promise<void> => {
    await client.delete(`/model-groups/${id}`);
  },

  removeModelFromGroup: async (groupId: string, modelId: string): Promise<void> => {
    await client.delete(`/model-groups/${groupId}/models/${modelId}`);
  },
};
