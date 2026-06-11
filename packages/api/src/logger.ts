type LogArg = unknown;

function prefix(message: string): string {
  return message.startsWith('[backlogger]') ? message : `[backlogger] ${message}`;
}

export const logger = {
  info(message: string, ...args: LogArg[]): void {
    // eslint-disable-next-line no-console
    console.log(prefix(message), ...args);
  },
  warn(message: string, ...args: LogArg[]): void {
    // eslint-disable-next-line no-console
    console.warn(prefix(message), ...args);
  },
  error(message: string, ...args: LogArg[]): void {
    // eslint-disable-next-line no-console
    console.error(prefix(message), ...args);
  },
};
