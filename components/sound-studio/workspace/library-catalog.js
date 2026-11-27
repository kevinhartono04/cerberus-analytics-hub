import { normalizeLibraryReference } from './model.js';

export function validateCatalogSnapshot(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.sounds) || !value.sounds.length) throw Error('The exported sound catalog is not valid.');
  const sounds = value.sounds.map(normalizeLibraryReference);
  if (new Set(sounds.map(sound => sound.id)).size !== sounds.length) throw Error('The exported sound catalog contains duplicate IDs.');
  return {sounds, importedOn:typeof value.importedOn === 'string' ? value.importedOn : ''};
}

// Share one request between pickers. Load only when the Cerberator tab is opened.
let request;
export function loadCatalogSnapshot() {
  if (!request) request = fetch('/api/sound-studio/catalog')
    .then(response => {if (!response.ok) throw Error('Could not load the exported sound catalog.'); return response.json();})
    .then(validateCatalogSnapshot)
    .catch(error => {request = undefined; throw error;});
  return request;
}
