const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function server() {
  const routes = new Map();
  const app = {disable(){},use(){},get(){},patch(){},delete(){},listen(){},post(p,...h){routes.set(p,h);}};
  const express = Object.assign(()=>app,{json:()=>()=>{}});
  const context = vm.createContext({require:n=>n==='express'?express:n==='pg'?{Pool:class{}}:require(n), process:{env:{}}, console:{log(){},error(){}}, Buffer, __dirname:path.join(root,'app')});
  vm.runInContext(fs.readFileSync(path.join(root,'app/server.js'),'utf8'),context);
  const handlers=routes.get('/api/chat');
  return {context,handlers};
}
function response(){return {code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};}
test('chat fails closed when database is unavailable',()=>{
  const {handlers}=server(),res=response();let next=false;
  handlers[0]({},res,()=>next=true);
  assert.equal(res.code,503);assert.equal(next,false);
});
test('signed-out and expired sessions cannot reach model configuration',async()=>{
  const {context,handlers}=server();
  vm.runInContext('databaseReady=true; pool={query:async()=>({rows:[]})};',context);
  for(const cookie of ['', 'unbound_session=expired']){
    const res=response();await handlers[1]({headers:{cookie},body:{message:'hello'}},res);
    assert.equal(res.code,401);assert.match(res.body.error,/Sign in/);
  }
});
test('signed-in ordinary users reach chat validation',async()=>{
  const {context,handlers}=server();
  vm.runInContext('findSessionUser=async()=>({id:1,role:"user",plan_tier:"free"});',context);
  const res=response();await handlers[1]({body:{message:''}},res);
  assert.equal(res.code,400);assert.match(res.body.error,/enter a message/);
});
function browser(){
  const elements=new Map();
  function el(){return {value:'',hidden:true,disabled:false,textContent:'',innerHTML:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},focus(){},reset(){},appendChild(){},remove(){}};}
  const document={getElementById(id){if(!elements.has(id))elements.set(id,el());return elements.get(id);},createElement:el,body:el(),addEventListener(){}};
  const storage=new Map();let calls=0;
  const context=vm.createContext({document,console,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},window:{setTimeout(){},clearTimeout(){},confirm:()=>true},fetch:async()=>{calls++;return {ok:false,status:401,json:async()=>({})};}});
  const html=fs.readFileSync(path.join(root,'app/index.html'),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('    initializePage();','');
  vm.runInContext(script,context);
  return {context,elements,get calls(){return calls;}};
}
test('guest sign-in prompt preserves draft and makes no chat request',async()=>{
  const b=browser();vm.runInContext('accountReady=true; input.value="keep this draft";',b.context);
  await vm.runInContext('sendMessage()',b.context);
  assert.equal(b.calls,0);assert.equal(b.elements.get('message').value,'keep this draft');assert.equal(b.elements.get('authModal').hidden,false);
});
test('expired session restores draft and requests sign-in',async()=>{
  const b=browser();vm.runInContext('accountReady=true;currentUser={id:"1"};input.value="draft";',b.context);
  await vm.runInContext('sendMessage()',b.context);
  assert.equal(b.calls,1);assert.equal(b.elements.get('message').value,'draft');assert.equal(b.elements.get('authModal').hidden,false);assert.equal(b.elements.get('sendButton').disabled,false);
});
test('pending reply prevents repeated submissions',async()=>{
  const b=browser();vm.runInContext('accountReady=true;chatBusy=true;input.value="duplicate";',b.context);
  await vm.runInContext('sendMessage()',b.context);assert.equal(b.calls,0);
});
