#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const SRC=fs.readFileSync(path.join(__dirname,'..','printer-bridge','server.js'),'utf8');

function fn(name){
  let start=SRC.indexOf('function '+name+'(');assert.ok(start>=0,'falta '+name);
  const open=SRC.indexOf('{',start);let d=0,q='',esc=false,line=false,block=false;
  for(let i=open;i<SRC.length;i++){
    const c=SRC[i],n=SRC[i+1];
    if(line){if(c==='\n')line=false;continue;}
    if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
    if(q){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===q)q='';continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}
    if(c==='/'&&n==='*'){block=true;i++;continue;}
    if(c==='"'||c==="'"||c.charCodeAt(0)===96){q=c;continue;}
    if(c==='{')d++;else if(c==='}'&&--d===0)return SRC.slice(start,i+1);
  }
  assert.fail('no cerró '+name);
}

test('bridge legado no permite CORS wildcard por defecto',()=>{
  assert.match(SRC,/BRIDGE_ALLOW_ORIGIN \|\| 'https:\/\/dashboard\.thelab\.solutions'/);
  assert.doesNotMatch(SRC,/BRIDGE_ALLOW_ORIGIN \|\| '\*'/);
  assert.match(SRC,/if\(origin&&!ALLOW_ORIGINS\.includes\(origin\)\)return false/);
});

test('CORS refleja solo un origen explícitamente permitido y agrega Vary',()=>{
  const setCors=new Function('ALLOW_ORIGINS',fn('setCors')+'\nreturn setCors;')(['https://dashboard.thelab.solutions']);
  const headers={};
  const res={setHeader:(k,v)=>{headers[k]=v;}};
  assert.equal(setCors({headers:{origin:'https://dashboard.thelab.solutions'}},res),true);
  assert.equal(headers['Access-Control-Allow-Origin'],'https://dashboard.thelab.solutions');
  assert.equal(headers.Vary,'Origin');
  const bad={};assert.equal(setCors({headers:{origin:'https://evil.example'}},{setHeader:(k,v)=>{bad[k]=v;}}),false);
  assert.equal(bad['Access-Control-Allow-Origin'],undefined);
});

test('comparación del token usa timingSafeEqual y conserva semántica exacta',()=>{
  const tokenMatches=new Function('Buffer','crypto','TOKEN',fn('tokenMatches')+'\nreturn tokenMatches;')(Buffer,crypto,'secreto-123');
  assert.equal(tokenMatches('secreto-123'),true);
  assert.equal(tokenMatches('secreto-124'),false);
  assert.equal(tokenMatches(''),false);
  assert.equal(tokenMatches('secreto-123-extra'),false);
  assert.match(fn('tokenMatches'),/crypto\.timingSafeEqual/);
  assert.doesNotMatch(SRC,/given !== TOKEN/);
});

test('restart del bridge legado es estrictamente POST-only',()=>{
  const restart=SRC.indexOf("if (rawPath === '/restart')");
  const next=SRC.indexOf("if (rawPath === '/pubkey')",restart);
  assert.ok(restart>0&&next>restart);
  const body=SRC.slice(restart,next);
  assert.match(body,/req\.method!=='POST'/);
  assert.match(body,/setHeader\('Allow','POST'\)/);
  assert.ok(body.indexOf("req.method!=='POST'")<body.indexOf('process.exit(0)'));
});

test('endpoints de lectura administrativos no aceptan mutaciones',()=>{
  const auth=SRC.slice(SRC.indexOf("if (rawPath === '/authcheck')"),SRC.indexOf("if (rawPath === '/restart')"));
  const pub=SRC.slice(SRC.indexOf("if (rawPath === '/pubkey')"),SRC.indexOf('const mChk ='));
  const ssh=SRC.slice(SRC.indexOf('if (mChk) {'),SRC.indexOf("if (rawPath === '/update'",SRC.indexOf('if (mChk) {')));
  for(const body of [auth,pub,ssh]){
    assert.match(body,/req\.method!=='GET'&&req\.method!=='HEAD'/);
    assert.match(body,/405/);
  }
});

test('origen no permitido se corta antes de OPTIONS y antes de autenticación',()=>{
  const serverPos=SRC.indexOf('const server = http.createServer');
  const section=SRC.slice(serverPos,serverPos+2200);
  const cors=section.indexOf('if(!setCors(req,res))');
  const options=section.indexOf("req.method === 'OPTIONS'");
  const auth=section.indexOf('tokenMatches(given)');
  assert.ok(cors>=0&&options>cors&&auth>options);
});
