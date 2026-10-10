import { ApiErrorSchema } from "visualizar-common";

export async function readApi<T>(
  path: string,
  schema: { parse: (data: unknown) => T },
  signal: AbortSignal,
  options?: { method: "POST" },
): Promise<T> {
  const response = await fetch(path, { ...options, signal });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = ApiErrorSchema.safeParse(body);
    throw new Error(
      error.success
        ? error.data.error.message
        : `Request failed (${response.status}).`,
    );
  }
  return schema.parse(body);
}
