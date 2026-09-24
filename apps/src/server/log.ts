/**
 * Minimal timestamped logger. DigitalOcean App Platform captures stdout/stderr
 * and shows it under the component's "Runtime Logs" tab.
 */
function stamp(): string {
  return new Date().toISOString();
}

export const log = {
  info: (msg: string, ...rest: unknown[]) => console.log(`${stamp()} [INFO] ${msg}`, ...rest),
  warn: (msg: string, ...rest: unknown[]) => console.warn(`${stamp()} [WARN] ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) => console.error(`${stamp()} [ERROR] ${msg}`, ...rest),
};
