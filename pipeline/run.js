#!/usr/bin/env node
// Walters weekly pipeline (model side). Uses the APP'S OWN functions, extracted from index.html, so nothing drifts.
//   node pipeline/run.js init-ratings         -> data/ratings.json (2026 opening: end-2025 x 0.75 + personnel deltas)
//   node pipeline/run.js odds [--close]       -> data/lines.json  (Odds API per book; open = first sighting, close = --close run)
//   node pipeline/run.js board                -> data/board.json  (every game: rosters+statuses -> deltas -> line vs market -> stars, pick, O/U)
//   node pipeline/run.js grade                -> grades the last completed week, CLV, TGPL re-rate all 32, calibration -> ratings/history/calib.json
//   node pipeline/run.js analyze              -> Fable/Opus/Sonnet reads for games >= STAR_THRESHOLD -> data/reads.json
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.join(__dirname,'..');const D=f=>path.join(ROOT,'data',f);
const rd=(f,dflt)=>{try{return JSON.parse(fs.readFileSync(D(f),'utf8'));}catch{return dflt;}};
const wr=(f,o)=>fs.writeFileSync(D(f),JSON.stringify(o,null,0));
const STAR_THRESHOLD=parseFloat(process.env.STAR_THRESHOLD||'1');
const READ_MODEL=process.env.READ_MODEL||'claude-fable-5-1';

// ---------- model engine (engine.js is the single source of truth, shared with the UI) ----------
function app(){
  const code=fs.readFileSync(path.join(ROOT,'engine.js'),'utf8');
  const WANT=['DEFAULT_RATINGS','HOME_ADV','PV','calcStars','POS_GROUP','STACK_MULT','Q_PCT','calcInjuryDelta','OU_WX','OFF_GROUPS','splitInjury','calcModelTotal','CALIB_DEFAULT','CALIB_PRIOR_N','HIST_STARS','hfaOf','wilson','computeCalibration','gradeSide','tgpl','clvOf','clvOuOf','OPENING_2026','OPENING_SHRINK','QB_SEED','ABBR'];
  const ctx={console};vm.createContext(ctx);
  vm.runInContext(code+'\nthis.__x={'+WANT.join(',')+'};',ctx);
  const missing=WANT.filter(w=>ctx.__x[w]===undefined);
  if(missing.length)throw new Error('engine.js missing: '+missing.join(','));
  return ctx.__x;
}
const A=app();
const key=(g)=>g.home+'|'+g.away;

// ---------- init ratings ----------
function initRatings(){
  const out={};Object.keys(A.DEFAULT_RATINGS).forEach(t=>{const o=A.OPENING_2026.find(x=>x.t===t);out[t]=parseFloat((A.DEFAULT_RATINGS[t]*A.OPENING_SHRINK+(o?o.d:0)).toFixed(2));});
  wr('ratings.json',{season:2026,asOfWeek:0,updated:new Date().toISOString(),ratings:out,note:'2026 opening: end-2025 x '+A.OPENING_SHRINK+' + personnel deltas'});
  console.log('ratings.json written (opening)');
}

// ---------- odds ----------
async function odds(close){
  const k=process.env.ODDS_API_KEY;if(!k){console.log('no ODDS_API_KEY; skipping');return;}
  const week=rd('week.json',null);if(!week)throw new Error('run fetch_data first');
  const r=await fetch('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey='+k+'&regions=us&markets=spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,caesars,betmgm');
  if(!r.ok)throw new Error('Odds API '+r.status);const d=await r.json();
  const norm=n=>Object.keys(A.DEFAULT_RATINGS).find(t=>t===n)||n;
  const lines=rd('lines.json',{});const now=new Date().toISOString();let n=0;
  week.games.forEach(g=>{
    const m=d.find(x=>norm(x.home_team)===g.home&&norm(x.away_team)===g.away);if(!m)return;
    const sp=[],by={},tots=[];
    (m.bookmakers||[]).forEach(bk=>{const sm=(bk.markets||[]).find(x=>x.key==='spreads');if(sm){const o=(sm.outcomes||[]).find(x=>norm(x.name)===g.home);if(o&&o.point!=null){const v=-o.point;sp.push(v);by[bk.title]=v;}}
      const tm=(bk.markets||[]).find(x=>x.key==='totals');if(tm){const o=(tm.outcomes||[]).find(x=>x.name==='Over');if(o&&o.point!=null)tots.push(o.point);}});
    if(!sp.length)return;
    const posted=parseFloat((sp.reduce((a,b)=>a+b,0)/sp.length).toFixed(1)),ou=tots.length?parseFloat((tots.reduce((a,b)=>a+b,0)/tots.length).toFixed(1)):null;
    const L=lines[key(g)]||{};
    lines[key(g)]={open:L.open!=null?L.open:posted,openOu:L.openOu!=null?L.openOu:ou,openTs:L.openTs||now,current:posted,currentOu:ou,byBook:by,ts:now,
      close:close?posted:L.close,closeOu:close?ou:L.closeOu,closeTs:close?now:L.closeTs,history:[...(L.history||[]).slice(-40),{ts:now,posted,ou}]};n++;
  });
  wr('lines.json',lines);console.log('lines.json: '+n+' games updated'+(close?' (CLOSE)':''));
}

// ---------- board ----------
function statusesFor(week,team){const inj=week.injuries[team]||{};const out={};Object.entries(inj).forEach(([n,v])=>{out[n]=v.status;});return out;}
function board(){
  const week=rd('week.json',null);if(!week)throw new Error('run fetch_data first');
  const R=rd('ratings.json',null);if(!R)throw new Error('run init-ratings first');
  const calib={...A.CALIB_DEFAULT,...(rd('calib.json',{}))};const lines=rd('lines.json',{});
  const qbMult=calib.nQb>=5?calib.qbMult:1;
  const games=week.games.map(g=>{
    const hR=R.ratings[g.home],aR=R.ratings[g.away];const hfa=g.neutral?0:A.hfaOf(calib);
    const hRos=(week.rosters[g.home]||[]).map(p=>({...p}));const aRos=(week.rosters[g.away]||[]).map(p=>({...p}));
    const hSt=statusesFor(week,g.home),aSt=statusesFor(week,g.away);
    const hD=A.calcInjuryDelta(hRos,hSt,qbMult),aD=A.calcInjuryDelta(aRos,aSt,qbMult);
    const base=parseFloat(((hR+hfa)-aR).toFixed(2));const line=parseFloat((base-hD.total+aD.total).toFixed(2));
    const L=lines[key(g)]||{};const mkt=L.current!=null?L.current:g.ref_spread;const mktOu=L.currentOu!=null?L.currentOu:g.ref_total;const mktSrc=L.current!=null?'odds':(g.ref_spread!=null?'nfldata':null);
    const st=mkt!=null?A.calcStars(line,mkt):{stars:0,pct:'0'};const stars=parseFloat(st.stars);
    const side=stars>=0.5?(line>mkt?'home':line<mkt?'away':null):null;
    const ou0=A.calcModelTotal(week.teamstats[g.home],week.teamstats[g.away],hD,aD,{});
    const modelOu=ou0?parseFloat((ou0.total*(calib.on?calib.ouScalar:1)).toFixed(1)):null;
    const ouEdge=modelOu!=null&&mktOu!=null?parseFloat((modelOu-mktOu).toFixed(1)):null;
    const inj=(dl,ros)=>dl.details.map(d=>({n:d.n,p:d.p,st:d.st,loss:d.loss,repl:d.repl,idx:(ros.find(x=>x.n===d.n)||{}).idx}));
    return{id:g.id,key:key(g),away:g.away,home:g.home,gameday:g.gameday,gametime:g.gametime,neutral:g.neutral,
      hR,aR,hfa,base,line,hInj:hD.total,aInj:aD.total,hStack:hD.stacked,aStack:aD.stacked,hInjuries:inj(hD,hRos),aInjuries:inj(aD,aRos),
      market:mkt,marketOu:mktOu,marketSrc:mktSrc,byBook:L.byBook||{},open:L.open!=null?L.open:null,close:L.close!=null?L.close:null,
      stars,pct:st.pct,side,edge:mkt!=null?parseFloat((line-mkt).toFixed(1)):null,
      modelOu,ouEdge,ouLean:ouEdge==null?null:ouEdge>=4?'STRONG OVER':ouEdge>=2.5?'OVER':ouEdge<=-4?'STRONG UNDER':ouEdge<=-2.5?'UNDER':null,
      units:{home:week.units[g.home]||null,away:week.units[g.away]||null},qbs:{home:hRos.filter(p=>p.p==='QB').slice(0,2),away:aRos.filter(p=>p.p==='QB').slice(0,2)}};
  }).sort((a,b)=>b.stars-a.stars||Math.abs(b.edge||0)-Math.abs(a.edge||0));
  wr('board.json',{season:week.season,week:week.week,generated:new Date().toISOString(),ratingsAsOf:R.asOfWeek,calib:{hfa:A.hfaOf(calib),ic:calib.ic,nIc:calib.nIc,ouScalar:calib.ouScalar,qbMult},sources:week.sources,games});
  console.log('board.json: '+games.length+' games, '+games.filter(g=>g.stars>=STAR_THRESHOLD).length+' at >= '+STAR_THRESHOLD+'*, market source: '+(games[0]&&games[0].marketSrc));
}

// ---------- grade ----------
function grade(){
  const week=rd('week.json',null);const R=rd('ratings.json',null);const hist=rd('history.json',{weeks:[]});
  const board=rd('board.json',null);if(!board)throw new Error('no board');
  const finals=week.games.filter(g=>g.home_score!=null&&g.away_score!=null);
  if(finals.length<board.games.length*0.5){console.log('only '+finals.length+' finals for week '+week.week+'; not grading yet');return;}
  if(hist.weeks.some(w=>w.week===board.week&&w.season===board.season)){console.log('week already graded');return;}
  const calib={...A.CALIB_DEFAULT,...(rd('calib.json',{}))};const hfaBase=A.hfaOf(calib);
  const before={...R.ratings},next={...R.ratings};const graded=[];
  board.games.forEach(bg=>{
    const f=finals.find(x=>x.id===bg.id);if(!f)return;
    const margin=f.home_score-f.away_score;const close=bg.close!=null?bg.close:(f.ref_spread!=null?f.ref_spread:bg.market);
    const hfa=bg.neutral?0:hfaBase;
    const out=bg.side&&close!=null?A.gradeSide(margin,close,bg.side):null;
    const clv=A.clvOf(bg.side,bg.market,close);
    const u=A.tgpl(before[bg.home],before[bg.away],f.home_score,f.away_score,bg.hInj||0,bg.aInj||0,hfa);
    next[bg.home]=u.nH;next[bg.away]=u.nA;
    graded.push({...bg,hs:f.home_score,as:f.away_score,margin,close,mechOutcome:out,clv,total:f.home_score+f.away_score,nH:u.nH,nA:u.nA,neutral:bg.neutral,modelLine:bg.line});
  });
  hist.weeks.push({season:board.season,week:board.week,gradedAt:new Date().toISOString(),ratingsBefore:before,games:graded});
  wr('history.json',hist);
  wr('ratings.json',{...R,asOfWeek:board.week,updated:new Date().toISOString(),ratings:next});
  // calibration from all graded slate games (app function; slates shape)
  const slates=hist.weeks.map(w=>({wk:w.week,games:w.games.map(g=>({hs:g.hs,as:g.as,modelLine:g.modelLine,close:g.close,neutral:g.neutral}))}));
  const histEntries=hist.weeks.flatMap(w=>w.games.filter(g=>g.modelOu!=null).map(g=>({hs:g.hs,as:g.as,modelOU:g.modelOu})));
  const c=A.computeCalibration(slates,histEntries,calib);wr('calib.json',c);
  const w=graded.filter(g=>g.mechOutcome==='W').length,l=graded.filter(g=>g.mechOutcome==='L').length;const clvs=graded.filter(g=>g.clv!=null).map(g=>g.clv);
  console.log('graded week '+board.week+': '+graded.length+' games | model picks '+w+'-'+l+' | avg CLV '+(clvs.length?(clvs.reduce((a,b)=>a+b,0)/clvs.length).toFixed(2):'--')+' | ratings re-rated (32) | IC '+c.ic+' n='+c.nIc);
}

// ---------- analyze (threshold games) ----------
async function analyze(){
  const k=process.env.ANTHROPIC_API_KEY;if(!k){console.log('no ANTHROPIC_API_KEY; skipping');return;}
  const board=rd('board.json',null);const reads=rd('reads.json',{});
  const todo=board.games.filter(g=>g.stars>=STAR_THRESHOLD&&!(reads[g.key]&&reads[g.key].week===board.week&&reads[g.key].line===g.line));
  for(const g of todo){
    const inj=(l,arr)=>arr.length?l+': '+arr.map(d=>d.n+' ('+d.p+') '+d.st+(d.repl?' repl '+d.repl:'')+' -'+d.loss).join('; '):l+': full strength';
    const pr='You are an NFL handicapper using Billy Walters\' method. Power ratings already contain player values; injuries are deltas net of the backup; stars measure disagreement with the market and are NOT edge by themselves.\n'+
      'GAME: '+g.away+' at '+g.home+(g.neutral?' (NEUTRAL SITE)':'')+' '+g.gameday+' '+g.gametime+'\n'+
      'Ratings: home '+g.hR+' away '+g.aR+' HFA '+g.hfa+' -> base line '+g.base+'\n'+inj('HOME',g.hInjuries)+'\n'+inj('AWAY',g.aInjuries)+'\n'+
      'Model line (home-favored positive): '+g.line+' | Market: '+g.market+' ('+g.marketSrc+') | disagreement '+g.edge+' | stars '+g.stars+' ('+g.pct+'%)\n'+
      'O/U: model '+g.modelOu+' vs market '+g.marketOu+(g.ouLean?' -> '+g.ouLean:'')+'\n'+
      (g.units.home&&g.units.away?'Units: home rush R '+g.units.home.R+' protection P '+g.units.home.P+'; away rush R '+g.units.away.R+' protection P '+g.units.away.P+' (additive; already in ratings)\n':'')+
      'Task: explain in 4-6 sentences what is driving the disagreement, whether it is information (injury/availability the market may not have priced) or noise (rating drift), and give a recommendation of TAKE HOME / TAKE AWAY / NO BET with confidence 1-5.\n'+
      'Reply with a single JSON object and nothing else -- no preamble, no markdown fence:\n'+
      '{"recommendation":"TAKE HOME|TAKE AWAY|NO BET","confidence":3,"read":"...","ou_take":"OVER|UNDER|NO BET","risks":"..."}';
    try{
      const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':k,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:READ_MODEL,max_tokens:2000,messages:[{role:'user',content:pr}]})});
      const d=await r.json();
      if(d.error)throw new Error((d.error.type||'')+' '+(d.error.message||JSON.stringify(d.error)));
      const blocks=d.content||[];
      const txt=blocks.map(b=>typeof b.text==='string'?b.text:'').join('\n').trim();
      let m=txt.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);          // fenced JSON
      if(!m)m=txt.match(/(\{[\s\S]*\})/);                                 // bare JSON
      if(!m){
        console.log('  no JSON in response for '+g.key+' | stop_reason='+d.stop_reason+' | blocks=['+blocks.map(b=>b.type).join(',')+'] | text[0,300]='+JSON.stringify(txt.slice(0,300)));
        throw new Error('no JSON in response');
      }
      reads[g.key]={...JSON.parse(m[1]),week:board.week,line:g.line,market:g.market,model:READ_MODEL,ts:new Date().toISOString()};
      console.log('read: '+g.away+' @ '+g.home+' -> '+reads[g.key].recommendation+' ('+reads[g.key].confidence+')');
    }catch(e){console.log('read failed '+g.key+': '+e.message);}
  }
  wr('reads.json',reads);console.log('reads.json: '+todo.length+' new reads');
}

(async()=>{const cmd=process.argv[2];const close=process.argv.includes('--close');
  if(cmd==='init-ratings')initRatings();else if(cmd==='odds')await odds(close);else if(cmd==='board')board();else if(cmd==='grade')grade();else if(cmd==='analyze')await analyze();else{console.log('usage: init-ratings | odds [--close] | board | grade | analyze');process.exit(1);}
})().catch(e=>{console.error(e);process.exit(1);});
