const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const start = source.indexOf("    async function sendMessage() {");
const end = source.indexOf("    async function goDeeper()", start);
assert.ok(start >= 0 && end > start);
function browser(mode, fetch) {
  const c = {
    chatRequestPending:false,serviceWriteBlocked:false,currentUser:{id:"owner"},
    accountAccess:{},activeConversationId:"chat1",conversationHistory:[],
    productMode:mode,depthStyle:"casual",aiStyle:{},MAX_CONTEXT_MESSAGES:20,
    input:{value:"unsent message",focus(){}},sendButton:{},goDeeperButton:{},
    addMessage(){return {classList:{add(){}},remove(){}};},saveConversation(){},
    updateGoDeeperVisibility(){},addTypingIndicator(){return {remove(){}};},
    renderAccountUi(){},renderConversation(){},renderMarkdown:s=>s,
    openAuth(mode){c.authMode=mode;},showAuthFeedback(message){c.feedback=message;},
    readJson:r=>r.json(),fetch,TextDecoder,Uint8Array
  };
  vm.createContext(c);vm.runInContext(source.slice(start,end),c);return c;
}
async function main() {
  for(const mode of ["chat","research"]){
    let release;let calls=0;
    const response = new Promise(resolve=>release=resolve);
    const c=browser(mode,()=>{calls++;return response;});
    const first=c.sendMessage();
    c.input.value="new draft";
    await c.sendMessage();
    assert.equal(calls,1,"duplicate send must not make a request");
    release({ok:false,status:401,json:async()=>({error:"Expired"})});
    await first;
    assert.equal(c.input.value,"unsent message\n\nnew draft");
    assert.equal(c.authMode,"login");assert.equal(c.currentUser,null);
    assert.equal(c.activeConversationId,null);assert.equal(c.conversationHistory.length,0);
    assert.equal(c.chatRequestPending,false);assert.equal(c.sendButton.disabled,false);
  }
  const c=browser("research",async()=>({ok:true,json:async()=>({reply:"Answer",conversationId:"chat1"})}));
  await c.sendMessage();
  assert.equal(c.conversationHistory[1].content,"Answer");
  assert.equal(c.authMode,undefined);assert.equal(c.chatRequestPending,false);
  console.log("PASS chat recovery: duplicate submissions blocked; streaming/research 401 restore both drafts; successful research preserved.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
