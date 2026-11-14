const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../cotiza.html'),'utf8');
const script=source.match(/<script>\n([\s\S]*?)<\/script>/)[1];
function harness(){
 const map=new Map(),store={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const elements=new Map();let submit,mode='timeout';const bodies=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',style:{},disabled:false,textContent:'Enviar',addEventListener:(event,fn)=>{if(id==='cotForm'&&event==='submit')submit=fn;},querySelectorAll:()=>[...elements.values()],reset:()=>{}});return elements.get(id);};
 for(const id of ['fName','fCompany','fEmail','fPhone','fService','fQty','fDate','fBudget','fMsg','fFile','cotForm','btnSend','formMsg','filePrev','filePrevName'])element(id);
 const context=vm.createContext({window:{},crypto:webcrypto,sessionStorage:store,URLSearchParams,FileReader:class{},
  location:{search:'',href:'https://test.invalid/cotiza'},document:{getElementById:element,querySelector:()=>({value:''})},
  fetch:async(_u,init)=>{bodies.push(JSON.parse(init.body));if(mode==='timeout')throw Error('network');return {ok:true,json:async()=>({ok:true})};}});
 vm.runInContext(script.replace('%%LEAD_WORKER_URL%%','https://test.invalid'),context);
 const fill=()=>{element('fName').value='Synthetic';element('fEmail').value='alpha@example.invalid';element('fMsg').value='Same commercial brief';};
 return {store,map,bodies,context,element,fill,send:()=>submit({preventDefault(){}}),recover:()=>{mode='success';}};
}
test('form retries original submission after timeout and assigns a fresh ID to the next identical request',async()=>{
 const h=harness();h.fill();await h.send();const first=h.bodies[0];assert.ok(first.submissionId);
 h.element('fMsg').value='changed after timeout';h.recover();await h.send();
 assert.equal(h.bodies[1].submissionId,first.submissionId);assert.equal(h.bodies[1].message,first.message);assert.equal(h.map.size,0);
 h.fill();await h.send();assert.notEqual(h.bodies[2].submissionId,first.submissionId);
});
test('storage failure prevents transmission and leaves the form data intact',async()=>{
 const h=harness();h.store.setItem=()=>{throw Error('quota');};h.fill();await h.send();
 assert.equal(h.bodies.length,0);assert.equal(h.element('fMsg').value,'Same commercial brief');
});
test('saved submission contains attachment and excludes the one-time Turnstile token',()=>{
 const h=harness();vm.runInContext("_submission(sessionStorage,'prepare',{name:'Synthetic',attachment:{data:'dGVzdA=='},turnstileToken:'one-time'});",h.context);
 const saved=JSON.parse([...h.map.values()][0]);assert.equal(saved.attachment.data,'dGVzdA==');assert.equal(saved.turnstileToken,undefined);
});
