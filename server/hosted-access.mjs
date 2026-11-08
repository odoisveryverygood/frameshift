/** Single-operator hosted access. This is deliberately not a public multi-tenant sandbox. */
import crypto from 'node:crypto';
const COOKIE='sift_session';
const hash=value=>crypto.createHash('sha256').update(String(value)).digest();
const equal=(a,b)=>crypto.timingSafeEqual(hash(a),hash(b));
const preview=pathname=>/^\/(?:preview|baseline|candidate|stl-preview)\//.test(pathname);
export function createHostedAccess({hosted=process.env.EARL_HOSTED==='1',origin=process.env.EARL_PUBLIC_ORIGIN,token=process.env.EARL_ADMIN_TOKEN,port=Number(process.env.PORT)||4310,now=Date.now}={}){
 let publicOrigin;
 if(hosted){
  if(typeof token!=='string'||token.length<24)throw Error('Hosted mode requires EARL_ADMIN_TOKEN with at least 24 characters.');
  try{const parsed=new URL(origin);if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(parsed.hostname))throw Error();if(parsed.origin!==origin)throw Error();publicOrigin=parsed;}catch{throw Error('Hosted mode requires EARL_PUBLIC_ORIGIN as one exact HTTPS origin.');}
 }
 const signed=payload=>crypto.createHmac('sha256',token||'local-only').update('sift-session-v1:'+payload).digest('base64url');
 function authenticated(req){
  if(!hosted)return true;
  const bearer=/^Bearer (.+)$/.exec(req.headers.authorization||'');if(bearer&&equal(bearer[1],token))return true;
  const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!cookie||cookie.length>256)return false;const [payload,signature,...extra]=cookie.split('.');if(!payload||!signature||extra.length||!equal(signature,signed(payload)))return false;
  try{const decoded=JSON.parse(Buffer.from(payload,'base64url').toString());return Number.isSafeInteger(decoded.expires)&&decoded.expires>now()&&decoded.expires<=now()+8*3600000;}catch{return false;}
 }
 function middleware(req,res,next){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  // Container platform probes may use an internal Host header. This endpoint
  // discloses no configuration, credentials or project state.
  if(req.path==='/healthz'&&['GET','HEAD'].includes(req.method))return res.json({ok:true,mode:hosted?'operator-hosted':'local'});
  const acceptedHosts=hosted?[publicOrigin.host,`127.0.0.1:${port}`,`localhost:${port}`]:[`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`];
  if(!acceptedHosts.includes(req.headers.host))return res.status(403).json({error:hosted?'Unrecognized hosted domain':'Local access only'});
  const acceptedOrigins=hosted?[publicOrigin.origin]:[`http://127.0.0.1:${port}`,`http://localhost:${port}`,`http://[::1]:${port}`];
  if(req.headers.origin&&!acceptedOrigins.includes(req.headers.origin)&&!(req.method==='GET'&&preview(req.path)&&req.headers.origin==='null'))return res.status(403).json({error:'Cross-origin requests denied'});
  if(hosted&&req.path!=='/api/session'&&!authenticated(req)){
   if(req.path.startsWith('/api/')||preview(req.path))return res.status(401).json({error:'Sign in with the operator access token.',authenticationRequired:true});
   return loginPage(res);
  }
  if(req.path.startsWith('/api/')&&!['GET','HEAD'].includes(req.method)&&!req.is('application/json')&&!(req.path==='/api/stl/import'&&req.is('application/octet-stream'))&&!(req.path==='/api/uploads/project'&&req.is('application/zip')))return res.status(415).json({error:'JSON or supported upload content type required'});
  next();
 }
 let attempts=[];
 function installSession(app){
  app.get('/api/session',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({hosted,authenticated:authenticated(req),operatorOnly:hosted});});
  app.post('/api/session',(req,res)=>{
   res.setHeader('Cache-Control','no-store');if(!hosted)return res.json({hosted:false,authenticated:true});
   attempts=attempts.filter(at=>at>now()-60000);if(attempts.length>=12)return res.status(429).json({error:'Too many login attempts. Try again in one minute.'});
   attempts.push(now());if(typeof req.body?.token!=='string'||req.body.token.length>1024||!equal(req.body.token,token))return res.status(401).json({error:'Incorrect operator access token.'});
   attempts=[];const payload=Buffer.from(JSON.stringify({expires:now()+8*3600000,nonce:crypto.randomBytes(12).toString('hex')})).toString('base64url');
   res.setHeader('Set-Cookie',`${COOKIE}=${payload}.${signed(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${publicOrigin.protocol==='https:'?'; Secure':''}`);res.json({hosted:true,authenticated:true});
  });
  app.delete('/api/session',(req,res)=>{res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${publicOrigin?.protocol==='https:'?'; Secure':''}`);res.json({authenticated:!hosted});});
 }
 return{hosted,middleware,installSession,authenticated,publicOrigin:publicOrigin?.origin};
}
function loginPage(res){
 const nonce=crypto.randomBytes(16).toString('base64');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
 return res.status(401).type('html').send(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sift · operator access</title><style nonce="${nonce}">body{background:#f8f6ef;color:#262b26;font:16px system-ui;display:grid;place-items:center;min-height:95vh}main{max-width:360px;padding:32px}h1{font-size:40px;letter-spacing:-2px}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%;margin-top:12px;border:1px solid #b8bcb2;border-radius:8px}button{background:#354b35;color:white;cursor:pointer}p{line-height:1.6;color:#62695e}</style><main><h1>sift.</h1><p>This workspace runs trusted project code. Enter the operator access token to continue.</p><form><input type="password" autocomplete="current-password" aria-label="Operator token" required><button>Open workspace</button></form><p role="status"></p></main><script nonce="${nonce}">document.querySelector('form').onsubmit=async event=>{event.preventDefault();const status=document.querySelector('[role=status]');try{const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:document.querySelector('input').value})});const result=await response.json();if(!response.ok)throw Error(result.error);location.assign('/')}catch(error){status.textContent=error.message}};</script></html>`);
}
