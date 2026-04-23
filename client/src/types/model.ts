export interface ModelSpec {
  label: string;
  value: string;
}

export interface ModelDownload {
  format: string;
  size: string;
  fileName?: string;
  downloadFormat?: string;
}

export interface ModelVersion {
  id: string;
  versionNumber: number;
  format: string;
  fileSize: string;
  vertexCount: number;
  faceCount: number;
  changeLog: string;
  createdBy: string;
  createdAt: string;
}

export interface Model {
  id: string;
  partNumber: string;
  name: string;
  description: string;
  subtitle: string;
  category: string;
  formats: string[];
  fileSize: string;
  specs: ModelSpec[];
  downloads: ModelDownload[];
  dimensions: string;
  downloadCount: number;
  thumbnailUrl?: string;
  modelUrl?: string;
  createdAt: string;
  updatedAt: string;
  versions?: ModelVersion[];
}

export interface Category {
  name: string;
  icon: string;
  count: number;
  children?: { name: string }[];
}
