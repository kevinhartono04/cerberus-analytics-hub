export function convertSenseRecord(key: string, document: Record<string, any>, emit: (key: string, payload: string, expiresAt: string) => Promise<void>, expiresAt: string): Promise<string>;
