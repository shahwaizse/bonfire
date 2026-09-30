// Preserve the initial runs; replace only the independently rerun, corrected case.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cases,SUITE_VERSION} from './cases.js';
const directory=path.join(path.dirname(fileURLToPath(import.meta.url)),'results');
const [initialPrefix,correctedPrefix,manifestFile]=process.argv.slice(2);
if(!initialPrefix||!correctedPrefix||!manifestFile) throw new Error('Usage: node bench/reconcile.js INITIAL_PREFIX CORRECTED_PREFIX ORIGINAL_CASE_MANIFEST');
const oldCases=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
const correctedId='stale-versus-live';
assert.equal(cases.length,oldCases.length);
for(const c of cases) if(c.id!==correctedId) assert.deepEqual(c,oldCases.find(o=>o.id===c.id),'Only the corrected case may differ');
const manifestHash=createHash('sha256').update(JSON.stringify(cases)).digest('hex');
for(const model of ['dolphin','qwen','gemma']) {
  const originalFile=path.join(directory,`${initialPrefix}-${model}-off-full.json`);
  const correctedFile=path.join(directory,`${correctedPrefix}-${model}-off-full.json`);
  const initial=JSON.parse(fs.readFileSync(originalFile,'utf8'));
  const correction=JSON.parse(fs.readFileSync(correctedFile,'utf8'));
  assert.ok(initial.summary.complete && correction.summary.complete);
  assert.equal(initial.results.length,cases.length*initial.repeat);
  assert.equal(correction.repeat,initial.repeat);
  assert.equal(correction.suite,SUITE_VERSION);
  assert.equal(correction.caseManifestHash,manifestHash);
  assert.equal(correction.profile,initial.profile);
  assert.equal(correction.modelMetadata.meta.size,initial.modelMetadata.meta.size);
  assert.equal(correction.serverProps.chat_template,initial.serverProps.chat_template);
  assert.deepEqual(correction.settings,initial.settings);
  assert.equal(correction.results.length,initial.repeat);
  assert.ok(correction.results.every(c=>c.id===correctedId));
  const audited=structuredClone(initial);
  audited.results=initial.results.map(c=>{
    const source=c.id===correctedId?correction.results.find(n=>n.repetition===c.repetition):c;
    assert.ok(source);assert.equal(source.prompt,c.prompt);
    return {...structuredClone(source),sourceRun:c.id===correctedId?correctedFile:originalFile};
  });
  audited.suite=SUITE_VERSION;
  audited.caseManifestHash=manifestHash;
  audited.completedAt=correction.completedAt;
  audited.audit={reason:'The initial stale-document fixture rejected legitimate verification with assets_find. Added a matching lookup response and raised the call budget from 2 to 3. Reran this case three times for every model; all other prompts, fixtures, settings, and recorded results are unchanged.',originalFile,correctedFile,originalSummary:initial.summary};
  const log=fs.readFileSync(path.join(directory,`${initialPrefix}-${model}-off-server.err.log`),'utf8');
  const gpu=log.match(/- Vulkan\d+ : (.+?) \((\d+) MiB/),cpu=log.match(/- CPU\s+: (.+?) \((\d+) MiB/);
  if(gpu&&cpu) audited.hardware={backend:'Vulkan',gpu:gpu[1].trim(),vramMiB:Number(gpu[2]),cpu:cpu[1].trim(),ramMiB:Number(cpu[2])};
  audited.summary={passed:audited.results.filter(c=>c.pass).length,total:audited.results.length,complete:true,requests:audited.results.reduce((n,c)=>n+c.turns.length,0)};
  const output=path.join(directory,`${initialPrefix}-${model}-off-audited.json`);
  fs.writeFileSync(output,JSON.stringify(audited,null,2)+'\n');
  console.log(`${model}: ${audited.summary.passed}/${audited.summary.total}; ${output}`);
}
