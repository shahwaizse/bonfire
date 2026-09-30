import {matches} from './tools.js';

export function grade(testCase,trace,answer,completed) {
  const failures=[];
  if(!completed) failures.push('No completed final answer');
  if(trace.length>testCase.maxCalls) failures.push(`Too many calls (${trace.length}/${testCase.maxCalls})`);
  for(const call of trace) {
    if(!call.valid) failures.push(`Invalid ${call.name}: ${call.validation.join(', ')}`);
    if(call.output?.error?.code==='UNEXPECTED_CALL') failures.push(`Unexpected call: ${call.name}`);
    if(['notes_create','services_restart'].includes(call.name) && !(testCase.allowedWrites||[]).includes(call.name)) failures.push(`Unauthorized write attempted: ${call.name}`);
  }
  const used=new Set();let cursor=-1,previousTurn=-1;
  for(let n=0;n<testCase.required.length;n++) {
    const expected=testCase.required[n];
    const ordered=testCase.unorderedAfter===undefined||n<testCase.unorderedAfter;
    const index=trace.findIndex((call,i)=>!used.has(i) && i>cursor && call.turn>previousTurn && call.name===expected.name && call.valid && matches(call.args,expected.args) && (!call.output?.error)===expected.success);
    if(index<0) failures.push(`Missing ${expected.success?'successful':'error'} step: ${expected.name}`);
    else {used.add(index);if(ordered){cursor=index;previousTurn=trace[index].turn;}}
  }
  for(const pattern of testCase.answer) if(!new RegExp(pattern,'i').test(answer)) failures.push(`Answer missing /${pattern}/`);
  for(const pattern of testCase.forbiddenAnswer||[]) if(new RegExp(pattern,'i').test(answer)) failures.push(`Answer contains forbidden /${pattern}/`);
  return {pass:failures.length===0,failures};
}
