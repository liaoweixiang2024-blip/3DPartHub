type AxiosLikeResponse = {
  data: unknown;
};

export function unwrapApiData<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value) {
    const outer = (value as { data?: unknown }).data;
    if (outer && typeof outer === "object" && "data" in outer) {
      return (outer as { data?: T }).data as T;
    }
    return outer as T;
  }
  return value as T;
}

export function unwrapResponse<T>(response: AxiosLikeResponse): T {
  const result = unwrapApiData<T>(response.data);
  return result;
}
