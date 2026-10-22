const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript');
function load(file,imports={}) {const module={exports:{}};new Function('require','exports',ts.transpile(fs.readFileSync(file,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}))(name=>name==='server-only'?{}:imports[name]||require(name),module.exports);return module.exports;}
const urls=load('app/_lib/transcriptImageUrls.ts');
test('Windows, POSIX and escaped local images resolve through message identity',()=>{
 for(const value of ['C:/work/test/screen.png','/C:/work/test/screen.png','/home/test/screen.png','./screen.webp']) {
  assert.equal(urls.transcriptImageUrl(value,`![screen](${value})`,'codex:chat:1'),'/api/agent/image?messageId=codex%3Achat%3A1&reference=0');
 }
 assert.ok(urls.transcriptImageUrl('C:/folder/a%20b.png','![screen](<C:/folder/a b.png>)','codex:chat:1'));
 assert.equal(urls.transcriptImageUrl('C:/unmentioned.png','![other](C:/other.png)','codex:chat:1'),null);
 assert.equal(urls.transcriptImageUrl('https://example.com/a.png','', 'x'),null);
 assert.equal(urls.transcriptImageUrl('javascript:alert(1)','', 'x'),null);
});
test('server serves only a real image referenced by an existing message',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dashboard-images-'));
 const image=path.join(directory,'test.png');
 fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1kAAAAASUVORK5CYII=','base64'));
 const messageId='codex:chat:1';
 const mod=load('app/_lib/transcriptLocalImage.ts',{'./transcriptImageUrls':urls,'./agentArchive':{getAgentThread:id=>id==='chat'?{id,provider:'codex',cwd:directory}:null,getAgentThreadMessages:()=>[{id:messageId,text:`![screen](<${image}>)`}]}});
 try {
  const result=await mod.readTranscriptLocalImage(messageId,0);assert.equal(result.type,'image/png');assert.deepEqual(result.bytes,fs.readFileSync(image));
  assert.equal(await mod.readTranscriptLocalImage(messageId,1),null);
  assert.equal(await mod.readTranscriptLocalImage('codex:chat:9',0),null);
  assert.equal(await mod.readTranscriptLocalImage('claude-code:chat:1',0),null);
  fs.writeFileSync(image,'not an image');assert.equal(await mod.readTranscriptLocalImage(messageId,0),null);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
