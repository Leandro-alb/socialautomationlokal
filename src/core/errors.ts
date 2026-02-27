export class AppError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code = 'APP_ERROR', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};
