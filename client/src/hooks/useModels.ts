import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { modelApi } from '../api/models';
import type { ServerModelListItem, ServerModelDetail } from '../api/models';
import type { PaginatedResponse, PaginationParams } from '../types';

export function useModels(
  params?: PaginationParams & {
    category?: string;
    categoryId?: string;
    search?: string;
    format?: string;
    sort?: string;
  },
) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const search = params?.search || '';
  const format = params?.format || '';
  const category = params?.category || '';
  const categoryId = params?.categoryId || '';
  const sort = params?.sort || '';

  const key = `/models?page=${page}&pageSize=${pageSize}&search=${search}&format=${format}&category=${category}&categoryId=${categoryId}&sort=${sort}`;

  const { data, error, isLoading, isValidating, mutate } = useSWR<PaginatedResponse<ServerModelListItem>>(
    key,
    () =>
      modelApi.list({
        page,
        pageSize,
        search: search || undefined,
        format: format || undefined,
        category: category || undefined,
        categoryId: categoryId || undefined,
        sort: sort || undefined,
      }),
    { keepPreviousData: true },
  );

  return { data, error, isLoading: isLoading && !data, isValidating, mutate };
}

export function useInfiniteModels(
  params?: PaginationParams & {
    category?: string;
    categoryId?: string;
    search?: string;
    format?: string;
    sort?: string;
  },
  initialSize = 1,
) {
  const pageSize = params?.pageSize || 50;
  const search = params?.search || '';
  const format = params?.format || '';
  const category = params?.category || '';
  const categoryId = params?.categoryId || '';
  const sort = params?.sort || '';

  const getKey = (pageIndex: number, previousPageData: PaginatedResponse<ServerModelListItem> | null) => {
    if (previousPageData && previousPageData.page >= previousPageData.totalPages) return null;
    const page = pageIndex + 1;
    return `/models/infinite?page=${page}&pageSize=${pageSize}&search=${search}&format=${format}&category=${category}&categoryId=${categoryId}&sort=${sort}`;
  };

  const { data, error, isLoading, isValidating, mutate, setSize, size } = useSWRInfinite<
    PaginatedResponse<ServerModelListItem>
  >(
    getKey,
    (key: string) => {
      const url = new URL(key, window.location.origin);
      const page = Number(url.searchParams.get('page') || '1');
      return modelApi.list({
        page,
        pageSize,
        search: search || undefined,
        format: format || undefined,
        category: category || undefined,
        categoryId: categoryId || undefined,
        sort: sort || undefined,
      });
    },
    { initialSize, revalidateFirstPage: false },
  );

  const pages = data || [];
  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];
  const items = pages.flatMap((page) => page.items);
  const totalPages = firstPage?.totalPages || 1;
  const hasMore = Boolean(lastPage && lastPage.page < lastPage.totalPages);
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1] && !error);

  return {
    data: firstPage ? { ...firstPage, items, page: pages.length, totalPages } : undefined,
    error,
    isLoading: isLoading && pages.length === 0,
    isValidating,
    isLoadingMore,
    hasMore,
    size,
    setSize,
    mutate,
  };
}

export function useModel(id: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR<ServerModelDetail>(id ? `/models/${id}` : null, () =>
    id ? modelApi.getById(id) : Promise.reject('No ID'),
  );

  return { data, error, isLoading, mutate };
}
