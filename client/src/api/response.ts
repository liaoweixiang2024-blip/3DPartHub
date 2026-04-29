type AxiosLikeResponse = {
  data: unknown;
};

export function unwrapApiData<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data?: unknown }).data;
    if (data && typeof data === "object" && "data" in data) {
      return (data as { data?: T }).data as T;
    }
    return data as T;
  }
  return value as T;
}

export function unwrapResponse<T>(response: AxiosLikeResponse): T {
  return unwrapApiData<T>(response.data);
}
