export class HttpError extends Error {
  statusCode: number;
  /** Optional machine-readable code echoed to the client alongside the message.
   * Endpoints whose failures the frontend must distinguish (rewritetext: too-long
   * input vs. rate limit vs. model timeout) set it; everything else omits it and
   * the response shape stays exactly what it was. */
  code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "HttpError";
  }
}
