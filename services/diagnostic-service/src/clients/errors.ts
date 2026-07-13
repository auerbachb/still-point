export class NotConfiguredError extends Error {
  readonly service: string;

  constructor(service: string, detail: string) {
    super(`${service} is not configured: ${detail}`);
    this.name = "NotConfiguredError";
    this.service = service;
  }
}
