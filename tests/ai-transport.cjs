const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const transport=import('../extension/ai-transport.js');

test('worker heartbeat ends with the request and the overall deadline has a distinct reason',async t=>{
  const {requestLifetime,REQUEST_TIMEOUT}=await transport;
  t.mock.timers.enable({apis:['setInterval','setTimeout']});
  let beats=0;const runtime={getPlatformInfo:()=>{beats++;return Promise.resolve({});}};
  const done=new AbortController(),stop=requestLifetime(done,runtime);
  t.mock.timers.tick(20000);assert.equal(beats,1);stop();t.mock.timers.tick(REQUEST_TIMEOUT);assert.equal(beats,1);assert.equal(done.signal.aborted,false);
  const expired=new AbortController(),cleanup=requestLifetime(expired,runtime);
  t.mock.timers.tick(REQUEST_TIMEOUT);assert.equal(expired.signal.reason.name,'TimeoutError');cleanup();
});

test('nested SDK retry errors retain safe HTTP and transport diagnostics without forwarding provider details',async()=>{
  const {describeAIError,AITransportError}=await transport;
  for(const [status,pattern]of [[401,/密钥无效/],[402,/余额/],[404,/找不到/],[422,/参数/],[429,/过于频繁/],[503,/暂时不可用/]]){
    const message=describeAIError({lastError:{cause:{statusCode:status,message:'secret-provider-body',requestBody:{key:'secret'}}}});
    assert.match(message,pattern);assert.match(message,new RegExp(String(status)));assert.doesNotMatch(message,/secret/);
  }
  assert.match(describeAIError({cause:new AITransportError('headers-timeout')}),/25 秒/);
  assert.match(describeAIError({lastError:{cause:new AITransportError('body-timeout')}}),/120 秒/);
  assert.match(describeAIError({cause:{name:'AI_TypeValidationError',message:'private'}}),/不兼容/);
  const canceled=new AbortController();canceled.abort();assert.equal(describeAIError(null,canceled.signal),'已取消 AI 请求');
  const expired=new AbortController();expired.abort(new DOMException('private','TimeoutError'));assert.match(describeAIError(null,expired.signal),/180 秒/);
});

test('response headers and slow keep-alive body have separate deadlines; cancellation and stalled responses abort',async()=>{
  const {fetchAI}=await transport;
  const timers=new Set(),later=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);};
  const server=http.createServer((req,res)=>{
    if(req.url==='/headers')return later(()=>res.end('{}'),200);
    res.writeHead(200,{'content-type':'application/json'});res.write('\n');
    later(()=>res.end('{"ok":true}'),180);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetchAI(base+'/slow',{}, {headersMs:120,bodyMs:500});assert.deepEqual(await response.json(),{ok:true});
    await assert.rejects(fetchAI(base+'/headers',{}, {headersMs:40,bodyMs:500}),e=>e.code==='headers-timeout');
    await assert.rejects(fetchAI(base+'/body',{}, {headersMs:120,bodyMs:40}),e=>e.code==='body-timeout');
    const controller=new AbortController();later(()=>controller.abort(),25);
    await assert.rejects(fetchAI(base+'/cancel',{signal:controller.signal},{headersMs:120,bodyMs:500}),e=>e.name==='AbortError');
  }finally{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));}
});
