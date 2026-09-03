export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thin fetch wrapper for the same-origin /api backend. */
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = (await res.json()) as {
        error?: string;
        message?: string;
        issues?: { message?: string }[];
      };
      code = body?.error;
      if (body?.error === "validation_error" && Array.isArray(body.issues)) {
        const details = body.issues
          .map((i) => i.message)
          .filter(Boolean)
          .join("; ");
        message = details || body.error;
      } else if (body?.message) {
        message = body.message;
      } else if (body?.error) {
        message = body.error;
      }
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
