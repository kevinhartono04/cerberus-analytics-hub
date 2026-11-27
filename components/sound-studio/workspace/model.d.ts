export type SoundState = {schemaVersion: number; revision: number; games: any[]; assets: any[]; videos?: any[]};
export function validateState(state: unknown): SoundState;
export function stampAudit(next: SoundState, previous: SoundState, actor: string, now?: string): SoundState;
export function migrateState(state: unknown): SoundState;
export function normalizeLibraryReference(value: unknown): any;
