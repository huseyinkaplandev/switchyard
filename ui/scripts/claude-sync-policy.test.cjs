const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const moduleValue={exports:{}};
new Function('exports',ts.transpile(fs.readFileSync('app/_lib/claudeScheduleSyncPolicy.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(moduleValue.exports);
const choose=moduleValue.exports.scheduleCaptureSource;
const account=(key,live,valid=true)=>({key,live,valid,missing:[],notEnabled:[]});
test('account switch captures last source, never newly opened stale destination',()=>{
 assert.equal(choose('personal',{lastAccount:'work',needsInstall:false},{exportedFrom:'work',accounts:[account('work',false),account('personal',true,false)]}),'work');
});
test('unreconciled destination cannot overwrite canonical definitions on next poll',()=>{
 assert.equal(choose('personal',{lastAccount:'personal',needsInstall:true},{exportedFrom:'work',accounts:[account('work',false),account('personal',true,false)]}),null);
});
test('current source captures real edits and migrated targets become valid sources',()=>{
 assert.equal(choose('work',{lastAccount:'work',needsInstall:true},{exportedFrom:'work',accounts:[account('work',true,false)]}),'work');
 assert.equal(choose('personal',{lastAccount:'personal',needsInstall:true},{exportedFrom:'work',accounts:[account('personal',true)]}),'personal');
});
test('initial unknown account with incomplete data is never auto-exported',()=>{
 assert.equal(choose('new',null,{exportedFrom:'work',accounts:[account('new',true,false)]}),null);
});
