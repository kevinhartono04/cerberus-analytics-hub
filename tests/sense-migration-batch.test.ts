// @vitest-environment node
import {expect,it} from 'vitest';
import {migrationBatchSql} from '../scripts/sense-migration-batch.mjs';
it('keeps quotes and SQL-looking payload data inside a fresh dollar-quoted JSON literal',()=>{
 const batch=[{cache_key:"key'; ROLLBACK; --",payload:'quotes $$ 🎮 \\ $sense_old$ ; COMMIT;',created_at:'now',expires_at:'later'}];
 const sql=migrationBatchSql(batch);
 const tag=sql.match(/\$sense_[a-f0-9]+\$/)![0];
 expect(sql.split(tag)).toHaveLength(3);
 expect(JSON.parse(sql.split(tag)[1])).toEqual(batch);
 expect(sql).toContain('SET LOCAL statement_timeout=15000');
 expect(sql.endsWith('COMMIT;')).toBe(true);
});
it('rejects oversized batches before contacting the database',()=>{
 expect(()=>migrationBatchSql(Array.from({length:1025},()=>({payload:''})))).toThrow('bounded budget');
 expect(()=>migrationBatchSql([{payload:'x'.repeat(256*1024+1)}])).toThrow('bounded budget');
 expect(()=>migrationBatchSql(Array.from({length:1025},()=>({cache_key:'key'})),{write:false})).toThrow('bounded budget');
});

it('verification sends only keys and never uploads the shard bodies',()=>{
 const sql=migrationBatchSql(Array.from({length:512},(_,i)=>({cache_key:'sense:page:v4:key'+i,payload:'private shard body'})),{write:false});
 expect(sql).not.toContain('private shard body');
 expect(sql).not.toContain('INSERT INTO');
});
