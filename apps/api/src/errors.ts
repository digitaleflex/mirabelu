export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new HttpError(400, code, message);
export const unauthorized = (message = 'Authentification requise', code = 'UNAUTHORIZED') => new HttpError(401, code, message);
export const forbidden = (message = 'Accès refusé', code = 'FORBIDDEN') => new HttpError(403, code, message);
export const notFound = (message = 'Introuvable') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'CONFLICT') => new HttpError(409, code, message);
export const tooMany = (message: string) => new HttpError(429, 'RATE_LIMITED', message);
