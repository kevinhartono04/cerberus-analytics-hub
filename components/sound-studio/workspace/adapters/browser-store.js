import { validateState, stampAudit } from '../model.js';

const DB_NAME = 'cerebral-sound-studio-local-v1';
const STORE = 'demo';
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(Error('Browser storage is unavailable. Allow site storage to save your demo edits.')); };
  });
  return database;
}
export function prepareBrowserSave(next, previous, editorName) {
  next = validateState(structuredClone(next));
  previous = validateState(structuredClone(previous));
  if (next.revision !== previous.revision) throw Error('This browser has a newer saved version. Reload before saving.');
  const name = (editorName || 'Demo visitor').trim().slice(0, 60) || 'Demo visitor';
  const result = stampAudit(structuredClone(next), previous, name + ' (unverified)');
  result.revision = previous.revision + 1;
  return result;
}
async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let value, failure;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(failure || Error('Could not save in this browser. Storage may be full or disabled. Export a backup before clearing site data.'));
    const store = tx.objectStore(STORE);
    const request = store.get('state');
    request.onsuccess = () => {
      try { value = operation(request.result, store); }
      catch (error) { failure = error; tx.abort(); }
    };
  });
}
export const browserRepository = {
  async load() {
    const saved = await transaction('readonly', value => value);
    if (saved) return validateState(saved);
    const response = await fetch('/sound-studio/demo-state.json', {cache:'no-store'});
    if (!response.ok) throw Error('Could not load the demo samples. Refresh to try again.');
    const seed = validateState(await response.json());
    return transaction('readwrite', (current, store) => {
      if (current) return validateState(current);
      store.put(seed, 'state');
      return seed;
    });
  },
  async save(next, editorName) {
    return transaction('readwrite', (previous, store) => {
      if (!previous) throw Error('Demo storage was cleared. Reload to start again.');
      const result = prepareBrowserSave(next, previous, editorName);
      store.put(result, 'state');
      return result;
    });
  },
  async upload(file) {
    const types = {wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',m4a:'audio/mp4',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'};
    const type = types[file.name.split('.').pop().toLowerCase()];
    if (!type || file.size > 50 * 1024 * 1024) throw Error('Choose a supported audio or video file under 50 MB.');
    // Embedded media is saved with the spec in IndexedDB, never uploaded to a server.
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error('Could not read this file.'));
      reader.readAsDataURL(new Blob([file], {type}));
    });
    return {url};
  },
};
