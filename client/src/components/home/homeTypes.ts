export interface Category {
  id: string;
  name: string;
  icon: string;
  count: number;
  children: { id: string; name: string; count: number }[];
}

export interface Product {
  id: string;
  name: string;
  description: string;
  formats: string[];
  fileSize: string;
  category: string;
  thumbnailUrl?: string;
  createdAt?: string;
  fileSizeBytes?: number;
  variantCount?: number;
}

export type HomeBrowseState = {
  categoryId: string;
  query: string;
  page: number;
  pageSize: number;
  sort: string;
  restoreKey: string;
};

export type HomeBreadcrumb = {
  parent: string | null;
  child: string | null;
  label: string;
};

export type HomeViewMode = 'grid' | 'list';
