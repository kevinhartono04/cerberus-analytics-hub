import {serverRepository} from './server-store.js';
export const repository=serverRepository;
export const PUBLIC_DEMO=false;
export const SHARED_DEMO=true;
export const LIBRARY_URL='https://woylie-quoll-galah.vercel.app/sounds';
export function searchAssets(assets, query, category) {
  return assets.filter(a => (!category || a.category === category) &&
    [a.name, a.sourceGame, ...(a.tags || [])].join(' ').toLowerCase().includes(query.toLowerCase()));
}
