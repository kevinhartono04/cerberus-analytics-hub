export const MANIFEST_PAGE_LIMIT: number;
export const MANIFEST_TOTAL_LIMIT: number;
export function digest(value: string): string;
export function encodeHistory(app: import('./ludios-sense-history').StoredSenseHistory): {payload:string;coverage:NonNullable<import('./ludios-sense-history').StoredSenseHistory['historyWindows']>};
export function pageSenseManifest<T>(document:T,emit:(key:string,payload:string,expiresAt:string)=>Promise<void>,expiresAt:string):Promise<T>;
