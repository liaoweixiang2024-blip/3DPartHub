import useSWR from "swr";
import { modelApi } from "../api/models";
import type { ServerModelListItem, ServerModelDetail } from "../api/models";
import type { PaginatedResponse, PaginationParams } from "../types";

export function useModels(params?: PaginationParams & { category?: string; categoryId?: string; search?: string; format?: string; sort?: string }) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const search = params?.search || "";
  const format = params?.format || "";
  const category = params?.category || "";
  const categoryId = params?.categoryId || "";
  const sort = params?.sort || "";

  const key = `/models?page=${page}&pageSize=${pageSize}&search=${search}&format=${format}&category=${category}&categoryId=${categoryId}&sort=${sort}`;

  const { data, error, isLoading, isValidating, mutate } = useSWR<PaginatedResponse<ServerModelListItem>>(
    key,
    () => modelApi.list({ page, pageSize, search: search || undefined, format: format || undefined, category: category || undefined, categoryId: categoryId || undefined, sort: sort || undefined }),
    { keepPreviousData: true }
  );

  return { data, error, isLoading: isLoading && !data, isValidating, mutate };
}

export function useModel(id: string | undefined) {
  const { data, error, isLoading } = useSWR<ServerModelDetail>(
    id ? `/models/${id}` : null,
    () => (id ? modelApi.getById(id) : Promise.reject("No ID"))
  );

  return { data, error, isLoading };
}
