// Focused A1/S2 compatibility on one SQLite DO. No Cloudflare API calls.
// prettier-ignore
import assert from 'node:assert/strict';
// prettier-ignore
import {createHash} from 'node:crypto';
// prettier-ignore
import {readFile} from 'node:fs/promises';
// prettier-ignore
import {DatabaseSync} from 'node:sqlite';
// prettier-ignore
import {URL} from 'node:url';
// prettier-ignore
import test from 'node:test';
// prettier-ignore
import worker, {GateAWatchdogDurableObject as Combined} from '../.github/staging-ai-02-07-05/cloudflare-gatea-live-candidate.mjs';
// prettier-ignore
import {GateAWatchdogDurableObject as A1} from '../.github/staging-ai-02-07-05/cloudflare-gatea-a1-preserved.mjs';

// prettier-ignore
const NOW=Date.parse('2026-11-03T00:00:00Z');
// prettier-ignore
const scope=Object.freeze({
  repository:'bingohooah888-ai/novelrise',stagingProjectRef:'wmlzjgvxgoyrovdhbqbg',
  mainSha:'a'.repeat(40),previewDeploymentId:'dpl_synthetic123',
  actorId:'11111111-1111-4111-8111-111111111111',novelId:41,
  episodeId:11,runId:1001,approvalCommentId:777
});
// prettier-ignore
const envA1=Object.freeze({GATEA_LOCAL_SYNTHETIC_ONLY:'true'});
// prettier-ignore
const arm=()=>({scope,controllerKeyId:'synthetic-controller-key',
  challengeNonce:'A'.repeat(44),observedAtMs:NOW,heartbeatAtMs:NOW});

// prettier-ignore
function harness(){
  const db=new DatabaseSync(':memory:');
  let now=NOW,inTransaction=false,alarmAt=null,deleteCount=0;
  const storage={
    sql:{exec(q,...params){
      const statement=db.prepare(q);
      const data=/^\s*(?:SELECT|WITH|PRAGMA)\b/iu.test(q)
        ? statement.all(...params):(statement.run(...params),[]);
      return {toArray:()=>data};
    }},
    transactionSync(fn){
      if(inTransaction)throw Error('unexpected nested transaction');
      inTransaction=true;
      db.exec('BEGIN IMMEDIATE');
      try{const value=fn();db.exec('COMMIT');return value;}
      catch(error){db.exec('ROLLBACK');throw error;}
      finally{inTransaction=false;}
    },
    async setAlarm(value){alarmAt=value;},
    async deleteAlarm(){alarmAt=null;deleteCount++;}
  };
  return {db,ctx:{storage},clock:()=>now,moveTo:(delta)=>{now=NOW+delta;},
    getAlarm:()=>alarmAt,getDeleteCount:()=>deleteCount};
}

// prettier-ignore
test('original A1 source has exact verified ZIP hash and unchanged inherited methods',async()=>{
  const content=await readFile(new URL(
    '../.github/staging-ai-02-07-05/cloudflare-gatea-a1-preserved.mjs',
    import.meta.url
  ));
  assert.equal(content.length,9018);
  assert.equal(createHash('sha256').update(content).digest('hex'),
    '31a0f76a812aa044cd84bedf96c5cc0577aa97dbe58de6393711885dc390267b');
  assert.equal(Object.getPrototypeOf(Combined.prototype),A1.prototype);
  for(const method of ['armSynthetic','heartbeatSynthetic','stopSynthetic',
    'statusSynthetic','scheduleOrFailClosed','readRow','ledger']){
    assert.equal(Combined.prototype[method],A1.prototype[method],method);
  }
});

// prettier-ignore
test('old A1 persisted SQLite scope, heartbeat, alarm and stop survive class update',async()=>{
  const h=harness();
  try{
    const old=new A1(h.ctx,envA1,h.clock);
    assert.equal((await old.armSynthetic(arm())).state,'WATCHING_SYNTHETIC');
    const originalKey=h.db.prepare('SELECT scope_key FROM gatea_watchdog_local WHERE id=1').get().scope_key;
    const combined=new Combined(h.ctx,envA1,h.clock);
    h.moveTo(2000);
    assert.equal((await combined.heartbeatSynthetic({scope,observedAtMs:NOW+2000,
      heartbeatAtMs:NOW+1000})).state,'WATCHING_SYNTHETIC');
    assert.equal(h.getAlarm(),NOW+16000);
    h.moveTo(17000);
    assert.equal((await combined.alarm()).state,'HEARTBEAT_EXPIRED_UNVERIFIED');
    assert.equal((await combined.alarm()).state,'HEARTBEAT_EXPIRED_UNVERIFIED');
    assert.equal((await combined.stopSynthetic({scope})).state,'STOPPED_SYNTHETIC');
    assert.equal((await combined.stopSynthetic({scope})).state,'STOPPED_SYNTHETIC');
    assert.equal(h.getDeleteCount(),1);
    assert.equal(h.db.prepare('SELECT scope_key FROM gatea_watchdog_local WHERE id=1').get().scope_key,originalKey);
    assert.equal(h.db.prepare('SELECT count(*) n FROM gatea_arm_spent').get().n,1);
    assert.equal(h.db.prepare('SELECT count(*) n FROM gatea_recovery_rounds').get().n,0);
    assert.equal(h.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='gatea_live_once'").get().n,0);
  }finally{h.db.close();}
});

// prettier-ignore
test('disabled S2 preserves old A1 rows and pending alarms even without A1 flag',async()=>{
  const h=harness();
  try{
    await new A1(h.ctx,envA1,h.clock).armSynthetic(arm());
    const row=h.db.prepare('SELECT * FROM gatea_watchdog_local').all();
    const alarmAt=h.getAlarm();
    h.moveTo(40000);
    const combined=new Combined(h.ctx,{},h.clock);
    assert.equal(await combined.alarm(),undefined);
    assert.deepEqual(h.db.prepare('SELECT * FROM gatea_watchdog_local').all(),row);
    assert.equal(h.getAlarm(),alarmAt);
    assert.equal(h.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='gatea_live_once'").get().n,0);
    await assert.rejects(combined.arm(),/CLOUDFLARE_LIVE_NO_GO/u);
    await assert.rejects(combined.heartbeat(),/CLOUDFLARE_LIVE_NO_GO/u);
    await assert.rejects(combined.readReceipt(),/CLOUDFLARE_LIVE_NO_GO/u);
  }finally{h.db.close();}
});

// prettier-ignore
test('conflicting A1/S2 flags never arm S2 or cause alarm retries',async()=>{
  const h=harness();
  try{
    await new A1(h.ctx,envA1,h.clock).armSynthetic(arm());
    const row=h.db.prepare('SELECT * FROM gatea_watchdog_local').all();
    const env={GATEA_LOCAL_SYNTHETIC_ONLY:'true',GATEA_LIVE_ENABLED:'true',
      GATEA_HTTP_ADMISSION_ENABLED:'true'};
    const combined=new Combined(h.ctx,env,h.clock);
    assert.equal(await combined.alarm(),undefined);
    await assert.rejects(combined.arm(),/CLOUDFLARE_LIVE_NO_GO/u);
    assert.deepEqual(h.db.prepare('SELECT * FROM gatea_watchdog_local').all(),row);
    assert.equal((await worker.fetch({method:'POST'},env)).status,404);
  }finally{h.db.close();}
});

// prettier-ignore
test('future S2 alarm sees no live table and leaves old A1 persisted data alone',async()=>{
  const h=harness();
  try{
    await new A1(h.ctx,envA1,h.clock).armSynthetic(arm());
    const row=h.db.prepare('SELECT * FROM gatea_watchdog_local').all();
    const combined=new Combined(h.ctx,{
      GATEA_LIVE_ENABLED:'true',GATEA_OWNER_PUB_SPKI:'x',
      GATEA_RUNNER_PUB_SPKI:'x',GATEA_CONTROLLER_PRIVATE_PKCS8:'x',
      GATEA_GITHUB_ACTIONS_READ_TOKEN:'x'
    },h.clock);
    assert.equal(await combined.alarm(),undefined);
    assert.deepEqual(h.db.prepare('SELECT * FROM gatea_watchdog_local').all(),row);
    assert.equal(h.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='gatea_live_once'").get().n,0);
  }finally{h.db.close();}
});

// prettier-ignore
test('same Worker/DO class, SQLite export, disabled flags and no migration',async()=>{
  const config=JSON.parse(await readFile(new URL(
    '../.github/staging-ai-02-07-05/wrangler.gatea.s2.candidate.jsonc',
    import.meta.url),'utf8'));
  assert.equal(config.account_id,'6831b18fe814232fa2dd4c470b95aa15');
  assert.equal(config.name,'novelight-ai-gatea-watchdog');
  assert.deepEqual(config.durable_objects.bindings,[
    {name:'GATEA_WATCHDOG',class_name:'GateAWatchdogDurableObject'}
  ]);
  assert.deepEqual(config.exports,{GateAWatchdogDurableObject:
    {type:'durable-object',storage:'sqlite'}});
  assert.equal(config.migrations,undefined);
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.equal(config.vars.GATEA_LIVE_ENABLED,'false');
  assert.equal(config.vars.GATEA_HTTP_ADMISSION_ENABLED,'false');
  assert.equal((await worker.fetch({method:'POST'},{})).status,404);
});
