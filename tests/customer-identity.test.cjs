const assert = require('node:assert/strict');
const { test, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'open-overskill-customers-'));
const sourceRoot = path.join(__dirname, '..');
const files = ['lib/customer-store.ts','lib/customer-auth.ts','lib/pilot-security.ts', ...['me','demo','login','callback','logout'].map(name=>`app/api/customer/${name}/route.ts`),
  'app/api/workspace/provision/route.ts', 'app/api/workspace/generate/route.ts', 'app/api/workspace/apps/[id]/deploy/route.ts'];
for (const file of files) {
  let source = fs.readFileSync(path.join(sourceRoot, file), 'utf8')
    .replace(/(["'])@\/([^"']+)\1/g, (_, quote, name) => JSON.stringify(path.join(output, name)))
    .replace('from "openid-client"', `from ${JSON.stringify(require.resolve('openid-client'))}`);
  const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
  const destination = path.join(output,file.replace(/\.ts$/,'.js'));
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,compiled.outputText);
}
const { CustomerStore, hashCustomerToken, getCustomerStore } = require(path.join(output,'lib/customer-store.js'));
const auth = require(path.join(output,'lib/customer-auth.js'));
const routes = Object.fromEntries(['me','demo','login','callback','logout'].map(name=>[name,require(path.join(output,`app/api/customer/${name}/route.js`))]));
// Isolate route authentication from workspace/provider writes. Any dispatch is
// recorded so a stale-tab rejection must happen before a side effect is called.
fs.writeFileSync(path.join(output,'lib/customer-workspace.js'), `
exports.calls = [];
exports.provisionWorkspace = async (_req,user) => { exports.calls.push({kind:'provision',userId:user.id}); return {provisioned:true}; };
exports.generateWorkspaceApp = async (_req,user) => { exports.calls.push({kind:'generate',userId:user.id}); return {id:'fixture-app'}; };
exports.deployWorkspaceApp = async (_req,user) => { exports.calls.push({kind:'deploy',userId:user.id}); return {id:'fixture-app'}; };
`);
const guardedWorkspace = require(path.join(output,'lib/customer-workspace.js'));
const workspaceRoutes = [
  ['/api/workspace/provision', require(path.join(output,'app/api/workspace/provision/route.js'))],
  ['/api/workspace/generate', require(path.join(output,'app/api/workspace/generate/route.js'))],
  ['/api/workspace/apps/fixture-app/deploy', require(path.join(output,'app/api/workspace/apps/[id]/deploy/route.js'))],
];
const originalEnv = {...process.env}; const originalFetch = global.fetch;
let origin = 'http://127.0.0.1:3577';
const request = (pathname, options = {}) => new Request(`${origin}${pathname}`,options);
function mutation(pathname, body, cookie) { return request(pathname,{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)}); }
const sessionCookie = response => response.headers.getSetCookie().find(value=>value.startsWith(auth.CUSTOMER_SESSION_COOKIE+'=')).split(';')[0];
const demo = async persona => {const response=await routes.demo.POST(mutation('/api/customer/demo',{persona}));assert.equal(response.status,200);return {cookie:sessionCookie(response),user:(await response.json()).user};};
beforeEach(()=>{
  for (const name of Object.keys(process.env)) if (name.startsWith('OPEN_OVERSKILL_')) delete process.env[name];
  process.env.OVERSKILL_MOCK='1';origin='http://127.0.0.1:3577';
  process.env.OPEN_OVERSKILL_DATA_DIR=fs.mkdtempSync(path.join(output,'store-'));
  guardedWorkspace.calls.length = 0;
  global.fetch=async()=>{throw new Error('Unexpected external request in customer tests');};
});
after(()=>{
  for (const store of global.__openOverskillCustomers?.values() || []) store.close();
  delete global.__openOverskillCustomers;
  global.fetch=originalFetch;
  for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
  Object.assign(process.env,originalEnv);fs.rmSync(output,{recursive:true,force:true});
});
function identity(subject,email='same@example.invalid'){return {issuer:'https://issuer.example.invalid',subject,email,emailVerified:true,name:subject};}
function app(user,id='app-local'){return {id,userId:user.id,appId:'backend-'+id,name:'Test app',prompt:'A test',jobId:null,status:null,messages:[],publishedUrl:null,deployState:'idle',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),simulated:true};}

test('trusted issuer+subject are stable while identical emails do not merge accounts',()=>{
  const store=getCustomerStore(); const alice=store.upsertIdentity(identity('alice'));const bob=store.upsertIdentity(identity('bob'));
  assert.notEqual(alice.id,bob.id);assert.notEqual(alice.externalCreatorId,bob.externalCreatorId);
  const again=store.upsertIdentity({...identity('alice'),email:'changed@example.invalid'});
  assert.equal(again.id,alice.id);assert.equal(again.externalCreatorId,alice.externalCreatorId);
  const other=store.upsertIdentity({...identity('alice'),issuer:'https://another.example.invalid'});
  assert.notEqual(other.id,alice.id);
});

test('creator credentials are encrypted, bound to customer, and survive reopening the database',()=>{
  const directory=process.env.OPEN_OVERSKILL_DATA_DIR;const store=new CustomerStore(directory,'demo');const alice=store.upsertIdentity(identity('alice'));const bob=store.upsertIdentity(identity('bob'));
  assert.equal(store.claimProvisioning(alice.id),true);assert.equal(store.claimProvisioning(alice.id),false);
  const key='secret-creator-key-should-never-be-readable';const binding={id:1,keyId:2,externalId:alice.externalCreatorId,teamId:3};
  store.saveCreator(alice.id,{key,binding,provisioned:{team:{id:3}}});store.saveApp(alice.id,app(alice));
  const token=store.createSession(alice.id,Date.now()+60000);store.close();
  for (const file of fs.readdirSync(directory)) assert.equal(fs.readFileSync(path.join(directory,file)).includes(Buffer.from(key)),false);
  const reopened=new CustomerStore(directory,'demo');
  assert.equal(reopened.getCreator(alice.id).key,key);assert.equal(reopened.getCustomer(alice.id).externalCreatorId,alice.externalCreatorId);assert.equal(reopened.getSession(token).userId,alice.id);
  assert.equal(reopened.getApp(alice.id,'app-local').appId,'backend-app-local');assert.equal(reopened.getApp(bob.id,'app-local'),undefined);assert.deepEqual(reopened.listApps(bob.id),[]);
  assert.throws(()=>reopened.saveCreator(bob.id,{key,binding,provisioned:{}}),/does not match/);
  assert.throws(()=>reopened.saveCreator(alice.id,{key,binding:{...binding,teamId:9},provisioned:{}}),/immutable/);
  assert.throws(()=>reopened.saveApp(bob.id,app(alice)),/ownership/);
  const safe=reopened.updateApp(alice.id,'app-local',{name:'Renamed',userId:bob.id,id:'stolen',appId:'foreign'});
  assert.equal(safe.userId,alice.id);assert.equal(safe.id,'app-local');assert.equal(safe.appId,'backend-app-local');assert.equal(safe.name,'Renamed');reopened.close();
});

test('one-use login state requires the same browser, expires, and is atomically consumed',()=>{
  const store=getCustomerStore();const state='state-value';const browser='browser-value';
  const attempt={state,browserHash:hashCustomerToken(browser),verifier:'private-pkce-verifier',nonce:'nonce',issuer:'https://issuer.example.invalid',expiresAt:Date.now()+60000};
  store.saveOidcAttempt(attempt);assert.equal(store.consumeOidcAttempt(state,'foreign-browser'),undefined);
  assert.deepEqual(store.consumeOidcAttempt(state,browser),attempt);assert.equal(store.consumeOidcAttempt(state,browser),undefined);
  store.saveOidcAttempt({...attempt,state:'expired',expiresAt:Date.now()-1});assert.equal(store.consumeOidcAttempt('expired',browser),undefined);
});

test('ambiguous provisioning and operation locks survive restart and never silently replay',()=>{
  const directory=process.env.OPEN_OVERSKILL_DATA_DIR;let store=new CustomerStore(directory,'demo');const user=store.upsertIdentity(identity('alice'));
  assert.equal(store.claimProvisioning(user.id),true);store.markCreatorState(user.id,'recovery_required');const lock=store.claimOperation(user.id,'generation');assert.ok(lock);store.close();
  store=new CustomerStore(directory,'demo');assert.equal(store.claimProvisioning(user.id),false);assert.equal(store.getCreator(user.id).state,'recovery_required');assert.equal(store.claimOperation(user.id,'generation'),null);
  store.releaseOperation(user.id,'generation','wrong-token');assert.equal(store.claimOperation(user.id,'generation'),null);
  store.releaseOperation(user.id,'generation',lock);assert.ok(store.claimOperation(user.id,'generation'));store.close();
});

test('customer sessions are hashed, absolute-expiring, isolated, and genuinely revoked at logout',async()=>{
  const alice=await demo('alice');const bob=await demo('bob');
  assert.equal(auth.requireCustomer(request('/api/customer/me',{headers:{cookie:alice.cookie}})).id,alice.user.id);
  assert.notEqual(alice.user.id,bob.user.id);assert.equal(alice.user.simulated,true);
  const token=alice.cookie.split('=')[1];const store=getCustomerStore();assert.equal(store.getSession(token,Date.now()+9*60*60*1000),undefined);
  const response=await routes.logout.POST(mutation('/api/customer/logout',{},alice.cookie));assert.equal(response.status,200);assert.match(response.headers.getSetCookie()[0],/Max-Age=0/);
  assert.equal(store.getSession(token),undefined);assert.throws(()=>auth.requireCustomer(request('/api/customer/me',{headers:{cookie:alice.cookie}})),{code:'customer_session_required'});
  assert.equal(auth.requireCustomer(request('/api/customer/me',{headers:{cookie:bob.cookie}})).id,bob.user.id);
});

test('same-origin mutations reject missing/cross origins, sibling sites, and forged hosts',async()=>{
  for(const headers of [{},{origin:'https://foreign.invalid'},{origin,'sec-fetch-site':'same-site'},{origin,host:'foreign.invalid'},{origin,'sec-fetch-site':'cross-site'}]){
    const response=await routes.demo.POST(request('/api/customer/demo',{method:'POST',headers:{'content-type':'application/json',...headers},body:'{"persona":"alice"}'}));assert.equal(response.status,403);
  }
  assert.equal((await routes.demo.POST(mutation('/api/customer/demo',{persona:'not-a-persona'}))).status,400);
  process.env.OVERSKILL_MOCK='0';assert.equal((await routes.demo.POST(mutation('/api/customer/demo',{persona:'alice'}))).status,404);
});

test('workspace routes reject a stale Alice tab with Bob cookies before any mutation dispatch',async()=>{
  const alice=await demo('alice');const bob=await demo('bob');
  for (const [pathname,route] of workspaceRoutes) {
    for (const expected of [undefined,alice.user.id]) {
      const req=mutation(pathname,{prompt:'A stale customer draft'},bob.cookie);
      if(expected)req.headers.set('X-Open-Overskill-Customer',expected);
      const response=await route.POST(req,{params:Promise.resolve({id:'fixture-app'})});
      assert.equal(response.status,409);
      assert.equal((await response.json()).code,'customer_session_changed');
      assert.deepEqual(guardedWorkspace.calls,[]);
    }
  }
  const valid=mutation('/api/workspace/generate',{prompt:'Bob explicitly builds'},bob.cookie);
  valid.headers.set('X-Open-Overskill-Customer',bob.user.id);
  assert.equal((await workspaceRoutes[1][1].POST(valid)).status,202);
  assert.deepEqual(guardedWorkspace.calls,[{kind:'generate',userId:bob.user.id}]);
  // Reads remain available to API clients without a header, but a supplied
  // stale identity can never mix Bob's credits/apps into Alice's visible UI.
  const staleRead=request('/api/workspace/credits',{headers:{cookie:bob.cookie,'X-Open-Overskill-Customer':alice.user.id}});
  assert.throws(()=>auth.requireCustomer(staleRead),{code:'customer_session_changed'});
  assert.equal(auth.requireCustomer(request('/api/workspace/credits',{headers:{cookie:bob.cookie}})).id,bob.user.id);
});

test('hosted origin requires HTTPS and explicit opt-in; live store requires a strong key',()=>{
  process.env.OVERSKILL_MOCK='0';process.env.OPEN_OVERSKILL_ORIGIN='https://builder.example.invalid';
  assert.throws(()=>auth.customerOrigin(),{code:'hosted_auth_not_enabled'});process.env.OPEN_OVERSKILL_HOSTED='1';assert.equal(auth.customerOrigin().origin,'https://builder.example.invalid');
  process.env.OPEN_OVERSKILL_ORIGIN='http://builder.example.invalid';assert.throws(()=>auth.customerOrigin(),{code:'hosted_auth_not_enabled'});
  assert.throws(()=>getCustomerStore(),/requires OPEN_OVERSKILL_ENCRYPTION_KEY/);process.env.OPEN_OVERSKILL_ENCRYPTION_KEY='short';assert.throws(()=>getCustomerStore(),/32 random bytes/);
  process.env.OPEN_OVERSKILL_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');assert.ok(getCustomerStore());
});

// These tests exercise real openid-client discovery, PKCE, token exchange,
// ID-token signature/issuer/audience/nonce validation against an in-memory HTTPS
// protocol fixture. Fetch is intercepted; no network, real identity or provider
// account is used or created.
async function oidcFixture({claimsPatch={},tamper=false}={}) {
  process.env.OVERSKILL_MOCK='0';process.env.OPEN_OVERSKILL_ORIGIN='https://builder.example.invalid';process.env.OPEN_OVERSKILL_HOSTED='1';
  process.env.OPEN_OVERSKILL_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');process.env.OPEN_OVERSKILL_OIDC_ISSUER='https://identity.example.invalid';process.env.OPEN_OVERSKILL_OIDC_CLIENT_ID='fixture-client';process.env.OPEN_OVERSKILL_OIDC_CLIENT_SECRET='fixture-client-secret';origin=process.env.OPEN_OVERSKILL_ORIGIN;
  const issuer=process.env.OPEN_OVERSKILL_OIDC_ISSUER;const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
  let authorize;let exchanges=0;
  global.fetch=async(url,options={})=>{
    const address=String(url);
    if(address===issuer+'/.well-known/openid-configuration')return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256']});
    if(address===issuer+'/jwks')return Response.json({keys:[jwk]});
    if(address===issuer+'/token'){
      exchanges++;const form=new URLSearchParams(options.body);assert.equal(form.get('code'),'fixture-code');assert.equal(form.get('redirect_uri'),origin+'/api/customer/callback');assert.equal(form.get('grant_type'),'authorization_code');
      assert.equal(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'),authorize.searchParams.get('code_challenge'));
      const now=Math.floor(Date.now()/1000);const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
      const payload={iss:issuer,sub:'stable-fixture-user',aud:'fixture-client',iat:now,exp:now+300,nonce:authorize.searchParams.get('nonce'),email:'builder@example.invalid',email_verified:true,name:'Fixture Builder',...claimsPatch};
      const base=encode({alg:'RS256',kid:'test-key'})+'.'+encode(payload);let signature=crypto.sign('RSA-SHA256',Buffer.from(base),privateKey).toString('base64url');if(tamper)signature=Buffer.alloc(256,1).toString('base64url');
      return Response.json({access_token:'fixture-only-token',token_type:'Bearer',expires_in:300,id_token:base+'.'+signature});
    }
    throw new Error('Unexpected fixture URL '+address);
  };
  const started=await routes.login.GET(request('/api/customer/login'));assert.equal(started.status,302);authorize=new URL(started.headers.get('location'));
  assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');assert.equal(authorize.searchParams.get('scope'),'openid profile email');assert.ok(authorize.searchParams.get('nonce'));assert.ok(authorize.searchParams.get('state'));
  const loginCookie=started.headers.getSetCookie()[0].split(';')[0];assert.match(started.headers.getSetCookie()[0],/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  const callback=`/api/customer/callback?state=${authorize.searchParams.get('state')}&code=fixture-code`;
  return {callback,loginCookie,getExchanges:()=>exchanges};
}

test('real OIDC protocol fixture validates PKCE and claims, creates a secure session, and rejects replay',async()=>{
  const fixture=await oidcFixture();
  const foreign=await routes.callback.GET(request(fixture.callback,{headers:{cookie:auth.CUSTOMER_OIDC_COOKIE+'='+crypto.randomBytes(32).toString('base64url')}}));assert.equal(foreign.status,400);assert.equal(fixture.getExchanges(),0);
  const response=await routes.callback.GET(request(fixture.callback,{headers:{cookie:fixture.loginCookie,'sec-fetch-site':'cross-site'}}));assert.equal(response.status,303);assert.equal(response.headers.get('location'),origin+'/workspace');assert.equal(fixture.getExchanges(),1);
  const cookie=sessionCookie(response);assert.match(response.headers.getSetCookie().find(x=>x.startsWith(auth.CUSTOMER_SESSION_COOKIE+'=')),/Secure/);
  const me=await routes.me.GET(request('/api/customer/me',{headers:{cookie}}));const body=await me.json();assert.equal(body.user.name,'Fixture Builder');assert.equal(body.user.simulated,false);assert.equal(body.authenticated,true);
  assert.equal((await routes.callback.GET(request(fixture.callback,{headers:{cookie:fixture.loginCookie}}))).status,400);assert.equal(fixture.getExchanges(),1);
});

test('OIDC rejects unverified email, wrong nonce, issuer, audience, expiry, and invalid signatures without sessions',async()=>{
  const variants=[{claimsPatch:{email_verified:false}},{claimsPatch:{nonce:'wrong-nonce'}},{claimsPatch:{iss:'https://foreign.invalid'}},{claimsPatch:{aud:'foreign-client'}},{claimsPatch:{exp:1}},{tamper:true}];
  for(const variant of variants){
    process.env.OPEN_OVERSKILL_DATA_DIR=fs.mkdtempSync(path.join(output,'oidc-invalid-'));
    const fixture=await oidcFixture(variant);const response=await routes.callback.GET(request(fixture.callback,{headers:{cookie:fixture.loginCookie}}));
    assert.ok(response.status>=400);assert.equal(response.headers.getSetCookie().some(x=>x.startsWith(auth.CUSTOMER_SESSION_COOKIE+'=')),false);
    const body=await response.json();assert.doesNotMatch(JSON.stringify(body),/fixture-client-secret|fixture-only-token|stable-fixture-user/);
    assert.equal((await routes.callback.GET(request(fixture.callback,{headers:{cookie:fixture.loginCookie}}))).status,400);
  }
});

test('pending submissions bind once; stale polling cannot overwrite newer writes or another customer app',()=>{
  const store=getCustomerStore();const alice=store.upsertIdentity(identity('alice'));const bob=store.upsertIdentity(identity('bob'));
  const pending={...app(alice),appId:'',submissionState:'pending'};store.saveApp(alice.id,pending);
  const submitted={...pending,appId:'real-backend-app',jobId:'new-job',submissionState:'confirmed'};store.saveApp(alice.id,submitted);
  assert.equal(store.compareAndSwapApp(alice.id,pending,{...pending,name:'stale'}),false);
  assert.equal(store.getApp(alice.id,pending.id).jobId,'new-job');
  assert.equal(store.compareAndSwapApp(alice.id,submitted,{...submitted,name:'Current name'}),true);
  assert.throws(()=>store.saveApp(alice.id,{...submitted,appId:'other-backend'}),/immutable/);
  assert.throws(()=>store.saveApp(bob.id,{...app(bob),appId:'real-backend-app'}),/UNIQUE constraint/);
});

test('database files never contain raw session credentials and reject the wrong encryption key',()=>{
  const directory=process.env.OPEN_OVERSKILL_DATA_DIR;const key=crypto.randomBytes(32).toString('base64');process.env.OPEN_OVERSKILL_ENCRYPTION_KEY=key;
  const store=new CustomerStore(directory,'live');const user=store.upsertIdentity(identity('alice'));const session=store.createSession(user.id,Date.now()+60000);
  store.saveCreator(user.id,{key:'must-remain-encrypted',provisioned:{team:{id:17}}});store.close();
  const raw=fs.readFileSync(path.join(directory,'customers-live.sqlite'));assert.equal(raw.includes(Buffer.from(session)),false);assert.equal(raw.includes(Buffer.from('must-remain-encrypted')),false);assert.equal(raw.includes(Buffer.from(hashCustomerToken(session))),true);
  process.env.OPEN_OVERSKILL_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');const wrong=new CustomerStore(directory,'live');assert.throws(()=>wrong.getCreator(user.id));wrong.close();
});

test('only a pristine provisioning claim is releasable after a known preflight failure',()=>{
  const store=getCustomerStore();const user=store.upsertIdentity(identity('alice'));
  assert.equal(store.claimProvisioning(user.id),true);store.releaseProvisioning(user.id);assert.equal(store.claimProvisioning(user.id),true);
  store.markCreatorState(user.id,'recovery_required');store.releaseProvisioning(user.id);assert.equal(store.getCreator(user.id).state,'recovery_required');assert.equal(store.claimProvisioning(user.id),false);
  store.saveCreator(user.id,{key:'encrypted-existing-key',provisioned:{team:{id:3}}});store.markCreatorState(user.id,'provisioning');store.releaseProvisioning(user.id);assert.equal(store.getCreator(user.id).key,'encrypted-existing-key');assert.equal(store.claimProvisioning(user.id),false);
});
