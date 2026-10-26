import {createHash} from 'node:crypto';
/** Existing inline charts and new references are equivalent only when their exact content hash matches. */
export function shardMatches(key,payload,checksum){
  if(checksum===createHash('sha256').update(payload).digest('hex'))return true;
  if(!/^sense:chart:v3:[a-f0-9]{64}$/.test(key))return false;
  const reference=JSON.parse(payload);
  return reference.format===4 && /^sense:chart-blob:v4:[a-f0-9]{64}$/.test(reference.chartRef ?? '') && checksum===reference.chartRef.slice(-64);
}
