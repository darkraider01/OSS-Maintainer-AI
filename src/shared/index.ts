// Shared helpers placeholder
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const truncateText = (text: string, len: number) =>
  text.length > len ? text.slice(0, len) + '...' : text;
