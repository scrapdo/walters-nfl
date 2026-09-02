// Walters model engine -- single source of truth for the math.
// Loaded by index.html (the weekly board) and parsed by pipeline/run.js (the automation),
// so the numbers on screen and the numbers in data/board.json cannot drift apart.
// Extracted from the v1 app; constants calibrated on 2015-2025 (see README and injury-calibration.md).
const DEFAULT_RATINGS = {
  "Seattle Seahawks":+7.25,"Los Angeles Rams":+5.60,"Houston Texans":+4.86,
  "New England Patriots":+4.07,"Jacksonville Jaguars":+4.03,"Denver Broncos":+3.15,
  "Buffalo Bills":+2.84,"Baltimore Ravens":+2.23,"Detroit Lions":+2.12,
  "San Francisco 49ers":+1.89,"Indianapolis Colts":+1.83,"Chicago Bears":+1.54,
  "Philadelphia Eagles":+1.52,"Los Angeles Chargers":+1.15,"Minnesota Vikings":+0.74,
  "Kansas City Chiefs":+0.58,"Green Bay Packers":+0.24,"Pittsburgh Steelers":+0.23,
  "Tampa Bay Buccaneers":-0.84,"New York Giants":-1.30,"Cincinnati Bengals":-2.16,
  "Atlanta Falcons":-2.19,"Carolina Panthers":-2.48,"Dallas Cowboys":-2.59,
  "Cleveland Browns":-3.01,"Miami Dolphins":-3.01,"New Orleans Saints":-3.07,
  "Washington Commanders":-3.70,"Arizona Cardinals":-3.72,"Tennessee Titans":-5.10,
  "Las Vegas Raiders":-5.71,"New York Jets":-6.98,
};

const OPENING_SHRINK = 0.75;

const OPENING_2026 = [
  {t:"Atlanta Falcons",d:+0.8,why:"QB: Penix 6.8 -> Tua 7.6"},
  {t:"Miami Dolphins",d:-1.3,why:"QB: Tua 7.6 -> Willis 6.3"},
  {t:"Minnesota Vikings",d:+1.2,why:"QB: McCarthy 6.7 -> Murray 7.9"},
  {t:"Arizona Cardinals",d:-1.3,why:"QB: Murray 7.9 -> Brissett 6.6"},
  {t:"New York Jets",d:+1.3,why:"QB: Taylor/Fields ~6.2 -> Geno 7.5"},
  {t:"Las Vegas Raiders",d:-0.3,why:"QB: Geno 7.5 -> Cousins 7.2"},
  {t:"Cleveland Browns",d:+0.4,why:"QB: rookie carousel ~6.1 -> Watson 6.5"},
  {t:"Kansas City Chiefs",d:+1.5,why:"Mahomes back from ACL (late-25 rating dragged by backup games)"},
  {t:"Denver Broncos",d:+0.5,why:"Nix back from playoff injury"},
];

const HOME_ADV = 2.0;

const PV = {1:3,2:3,3:8,4:3,5:3,6:5,7:6,8:3,9:2,10:4,11:2,12:2,13:2,14:5,15:2,16:3,17:3,18:3};

function calcStars(myLine, posted) {
  const lo=Math.min(myLine,posted), hi=Math.max(myLine,posted);
  let pct=0;
  for(let n=Math.ceil(lo);n<=Math.floor(hi);n++){
    const v=PV[n]||2;
    if(n===Math.ceil(lo)&&lo%1!==0) pct+=v*0.5;
    else if(n===Math.floor(hi)&&hi%1!==0) pct+=v*0.5;
    else pct+=v;
  }
  if(myLine>0&&posted<0) pct-=3;
  for(const [min,stars] of [[15,3],[13,2.5],[11,2],[9,1.5],[7,1],[5.5,0.5]])
    if(pct>=min) return {stars,pct:pct.toFixed(1)};
  return {stars:0,pct:pct.toFixed(1)};
}

const QB_SEED = {
  "Arizona Cardinals":{qb1:{n:"Jacoby Brissett",v:6.6,wx:{}},qb2:{n:"Gardner Minshew II",v:6.2}},
  "Atlanta Falcons":{qb1:{n:"Tua Tagovailoa",v:7.6,wx:{cold:-2,dome:1}},qb2:{n:"Michael Penix Jr.",v:6.8}},
  "Baltimore Ravens":{qb1:{n:"Lamar Jackson",v:9.3,wx:{}},qb2:{n:"Tyler Huntley",v:5.9}},
  "Buffalo Bills":{qb1:{n:"Josh Allen",v:9.5,wx:{hot:1,dome:1,cold:-1}},qb2:{n:"Kyle Allen",v:5.7}},
  "Carolina Panthers":{qb1:{n:"Bryce Young",v:7.0,wx:{}},qb2:{n:"Kenny Pickett",v:6.1}},
  "Chicago Bears":{qb1:{n:"Caleb Williams",v:8.0,wx:{}},qb2:{n:"Tyson Bagent",v:5.8}},
  "Cincinnati Bengals":{qb1:{n:"Joe Burrow",v:9.1,wx:{}},qb2:{n:"Joe Flacco",v:6.2}},
  "Cleveland Browns":{qb1:{n:"Deshaun Watson",v:6.5,wx:{}},qb2:{n:"Shedeur Sanders",v:6.1}},
  "Dallas Cowboys":{qb1:{n:"Dak Prescott",v:8.1,wx:{}},qb2:{n:"Joe Milton III",v:5.7}},
  "Denver Broncos":{qb1:{n:"Bo Nix",v:8.4,wx:{}},qb2:{n:"Jarrett Stidham",v:5.9}},
  "Detroit Lions":{qb1:{n:"Jared Goff",v:8.2,wx:{dome:1,cold:-1}},qb2:{n:"Joshua Dobbs",v:5.9}},
  "Green Bay Packers":{qb1:{n:"Jordan Love",v:8.0,wx:{cold:1}},qb2:{n:"Tyrod Taylor",v:6.1}},
  "Houston Texans":{qb1:{n:"C.J. Stroud",v:8.5,wx:{}},qb2:{n:"Davis Mills",v:5.9}},
  "Indianapolis Colts":{qb1:{n:"Daniel Jones",v:6.8,wx:{}},qb2:{n:"Anthony Richardson Sr.",v:6.2}},
  "Jacksonville Jaguars":{qb1:{n:"Trevor Lawrence",v:7.6,wx:{}},qb2:{n:"Nick Mullens",v:5.8}},
  "Kansas City Chiefs":{qb1:{n:"Patrick Mahomes",v:9.1,wx:{},note:"off ACL surgery"},qb2:{n:"Justin Fields",v:7.0}},
  "Las Vegas Raiders":{qb1:{n:"Kirk Cousins",v:7.2,wx:{dome:1,cold:-1}},qb2:{n:"Fernando Mendoza",v:5.6}},
  "Los Angeles Chargers":{qb1:{n:"Justin Herbert",v:8.6,wx:{}},qb2:{n:"Trey Lance",v:5.7}},
  "Los Angeles Rams":{qb1:{n:"Matthew Stafford",v:8.1,wx:{dome:1}},qb2:{n:"Stetson Bennett IV",v:5.5}},
  "Miami Dolphins":{qb1:{n:"Malik Willis",v:6.3,wx:{hot:1,cold:-1}},qb2:{n:"Quinn Ewers",v:5.7}},
  "Minnesota Vikings":{qb1:{n:"Kyler Murray",v:7.9,wx:{dome:1,cold:-1}},qb2:{n:"J.J. McCarthy",v:6.7}},
  "New England Patriots":{qb1:{n:"Drake Maye",v:8.6,wx:{cold:1}},qb2:{n:"Tommy DeVito",v:5.6}},
  "New Orleans Saints":{qb1:{n:"Tyler Shough",v:6.7,wx:{dome:1}},qb2:{n:"Spencer Rattler",v:5.8}},
  "New York Giants":{qb1:{n:"Jaxson Dart",v:7.4,wx:{}},qb2:{n:"Jameis Winston",v:6.2}},
  "New York Jets":{qb1:{n:"Geno Smith",v:7.5,wx:{}},qb2:{n:"Cade Klubnik",v:5.6}},
  "Philadelphia Eagles":{qb1:{n:"Jalen Hurts",v:8.7,wx:{}},qb2:{n:"Andy Dalton",v:5.8}},
  "Pittsburgh Steelers":{qb1:{n:"Aaron Rodgers",v:7.3,wx:{cold:1,hot:-1}},qb2:{n:"Mason Rudolph",v:6.0}},
  "San Francisco 49ers":{qb1:{n:"Brock Purdy",v:8.1,wx:{}},qb2:{n:"Mac Jones",v:6.0}},
  "Seattle Seahawks":{qb1:{n:"Sam Darnold",v:7.4,wx:{}},qb2:{n:"Drew Lock",v:6.0}},
  "Tampa Bay Buccaneers":{qb1:{n:"Baker Mayfield",v:7.8,wx:{hot:1}},qb2:{n:"Jake Browning",v:6.1}},
  "Tennessee Titans":{qb1:{n:"Cam Ward",v:7.1,wx:{}},qb2:{n:"Mitchell Trubisky",v:6.0}},
  "Washington Commanders":{qb1:{n:"Jayden Daniels",v:9.0,wx:{}},qb2:{n:"Marcus Mariota",v:6.0}},
};

const POS_GROUP={QB:"QB",RB:"RB",FB:"RB",WR:"REC",TE:"REC",OT:"OL",G:"OL",C:"OL",OL:"OL",EDGE:"DL",DE:"DL",DT:"DL",NT:"DL",DL:"DL",LB:"LB",ILB:"LB",OLB:"LB",MLB:"LB",CB:"DB",S:"DB",FS:"DB",SS:"DB",DB:"DB",K:"ST",P:"ST",LS:"ST"};

const STACK_MULT={REC:1.5,DL:1.4,OL:1.4,DB:1.35,LB:1.35,RB:1.3,QB:1,ST:1};

const Q_PCT={Q15:0.15,Q30:0.30,Q55:0.55};

const INJ_CALIB={"Out":"99.5% (n=5517)","Doubtful":"98-99% -> OUT (n=1104)","Q + DNP":"54% (n=1565)","Q + Limited":"30%; QB 52%, DB 36% (n=6200)","Q + Full":"15% (n=1731)","No tag + DNP":"12% (n=1921)"};

const OU_WX={dome:1,hot:0,cold:-1.5,wind:-2.5};

const OFF_GROUPS={QB:1,RB:1,REC:1,OL:1};

function splitInjury(delta){
  let off=0,def=0;
  delta.details.forEach(d=>{
    const g=POS_GROUP[d.p]||"ST";
    if(g==="ST")return;
    if(OFF_GROUPS[g])off+=d.loss;else def+=d.loss;
  });
  return{off:parseFloat(off.toFixed(2)),def:parseFloat(def.toFixed(2))};
}

function calcModelTotal(hStats,aStats,hDelta,aDelta,gameWx){
  if(!hStats||!aStats)return null;
  const hi=splitInjury(hDelta),ai=splitInjury(aDelta);
  const hPts=(hStats.off+aStats.def)/2 - 0.5*hi.off + 0.5*ai.def;
  const aPts=(aStats.off+hStats.def)/2 - 0.5*ai.off + 0.5*hi.def;
  let wx=0;Object.keys(OU_WX).forEach(k=>{if(gameWx[k])wx+=OU_WX[k];});
  return{total:parseFloat((hPts+aPts+wx).toFixed(1)),hPts:parseFloat(hPts.toFixed(1)),aPts:parseFloat(aPts.toFixed(1)),wx};
}

function calcInjuryDelta(roster,statuses,qbMult){
  const qm=qbMult||1;
  const groups={},details=[];let qbRaw=0;
  roster.forEach(pl=>{
    const st=statuses[pl.n]||"IN";
    if(st==="IN")return;
    let loss,repl=null;const val=x=>(x.ev!=null?x.ev:x.v);
    if(st==="OUT"){
      const r=roster.filter(x=>x.p===pl.p&&x.n!==pl.n&&(statuses[x.n]||"IN")!=="OUT"&&x.d>pl.d).sort((a,b)=>a.d-b.d)[0];
      const rv=r?val(r)*(1-(Q_PCT[statuses[r.n]]||0)):0;
      loss=Math.max(0,val(pl)-rv);repl=r?r.n:null;
    }else{
      const r=roster.filter(x=>x.p===pl.p&&x.n!==pl.n&&(statuses[x.n]||"IN")!=="OUT"&&x.d>pl.d).sort((a,b)=>a.d-b.d)[0];
      const rv=r?val(r)*(1-(Q_PCT[statuses[r.n]]||0)):0;
      loss=(Q_PCT[st]||0)*Math.max(0,val(pl)-rv);repl=r?r.n:null;
    }
    if(pl.p==="QB"){qbRaw+=loss;loss=loss*qm;}
    details.push({n:pl.n,p:pl.p,st,loss:parseFloat(loss.toFixed(2)),repl});
    const g=POS_GROUP[pl.p]||"OTHER";
    (groups[g]=groups[g]||[]).push(loss);
  });
  let total=0;const stacked=[];
  Object.entries(groups).forEach(([g,losses])=>{
    const sum=losses.reduce((a,b)=>a+b,0);
    const mult=losses.length>=2?(STACK_MULT[g]||1.3):1;
    if(mult>1&&sum>0)stacked.push(g);
    total+=sum*mult;
  });
  const qb=parseFloat(qbRaw.toFixed(2));
  return {total:parseFloat(total.toFixed(2)),details,stacked,qb,other:parseFloat((total-qb*qm).toFixed(2))};
}

const ABBR = {"Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF","Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE","Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB","Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC","Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC","Los Angeles Rams":"LAR","Miami Dolphins":"MIA","Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG","New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","San Francisco 49ers":"SF","Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WAS"};

const CLR = {"Arizona Cardinals":"#97233F","Atlanta Falcons":"#A71930","Baltimore Ravens":"#241773","Buffalo Bills":"#00338D","Carolina Panthers":"#0085CA","Chicago Bears":"#0B162A","Cincinnati Bengals":"#E04500","Cleveland Browns":"#FF3C00","Dallas Cowboys":"#003594","Denver Broncos":"#E05300","Detroit Lions":"#0076B6","Green Bay Packers":"#203731","Houston Texans":"#03202F","Indianapolis Colts":"#002C5F","Jacksonville Jaguars":"#006778","Kansas City Chiefs":"#E31837","Las Vegas Raiders":"#C8C0B0","Los Angeles Chargers":"#0080C6","Los Angeles Rams":"#003594","Miami Dolphins":"#008E97","Minnesota Vikings":"#4F2683","New England Patriots":"#002244","New Orleans Saints":"#9B8650","New York Giants":"#0B2265","New York Jets":"#125740","Philadelphia Eagles":"#004C54","Pittsburgh Steelers":"#A88000","San Francisco 49ers":"#AA0000","Seattle Seahawks":"#002244","Tampa Bay Buccaneers":"#D50A0A","Tennessee Titans":"#0C2340","Washington Commanders":"#5A1414"};

function normTeam(n){const m={"49ers":"San Francisco 49ers","Bears":"Chicago Bears","Bengals":"Cincinnati Bengals","Bills":"Buffalo Bills","Broncos":"Denver Broncos","Browns":"Cleveland Browns","Buccaneers":"Tampa Bay Buccaneers","Cardinals":"Arizona Cardinals","Chargers":"Los Angeles Chargers","Chiefs":"Kansas City Chiefs","Colts":"Indianapolis Colts","Cowboys":"Dallas Cowboys","Dolphins":"Miami Dolphins","Eagles":"Philadelphia Eagles","Falcons":"Atlanta Falcons","Giants":"New York Giants","Jaguars":"Jacksonville Jaguars","Jets":"New York Jets","Lions":"Detroit Lions","Packers":"Green Bay Packers","Panthers":"Carolina Panthers","Patriots":"New England Patriots","Raiders":"Las Vegas Raiders","Rams":"Los Angeles Rams","Ravens":"Baltimore Ravens","Saints":"New Orleans Saints","Seahawks":"Seattle Seahawks","Steelers":"Pittsburgh Steelers","Texans":"Houston Texans","Titans":"Tennessee Titans","Vikings":"Minnesota Vikings","Commanders":"Washington Commanders"};for(const[k,v]of Object.entries(m))if(n.includes(k))return v;return n;}

const CALIB_PRIOR_N=500;

const HIST_STARS={0.5:{p:49.5,n:192},1:{p:47.9,n:236},1.5:{p:55.3,n:190},2:{p:50.0,n:156},2.5:{p:54.5,n:55},3:{p:48.7,n:273}};

const CALIB_DEFAULT={hfaAdj:0,ouScalar:1,qbMult:1,nHfa:0,nOu:0,nQb:0,ic:null,nIc:0,on:true};

const hfaOf=c=>HOME_ADV+((c&&c.on)?(c.hfaAdj||0):0);

function wilson(w,n){
  if(!n)return null;
  const z=1.96,p=w/n,d=1+z*z/n,c=p+z*z/(2*n),s=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n);
  return[Math.max(0,(c-s)/d*100),Math.min(100,(c+s)/d*100)];
}

function computeCalibration(slates,history,prev){
  const c={...CALIB_DEFAULT,on:prev?prev.on:true};
  // HFA: all graded slate games, margin vs model line
  const errs=[];
  (slates||[]).forEach(s=>(s.games||[]).forEach(g=>{if(g.hs!=null&&g.modelLine!=null&&!g.neutral)errs.push((g.hs-g.as)-g.modelLine);}));
  if(errs.length){const b=errs.reduce((a,x)=>a+x,0)/errs.length;c.nHfa=errs.length;c.hfaAdj=parseFloat((b*errs.length/(errs.length+CALIB_PRIOR_N)).toFixed(2));}
  // information coefficient: slope of (margin-close) on (model-close) over slate games with closing lines
  const xs=[],ys=[];
  (slates||[]).forEach(s=>(s.games||[]).forEach(g=>{if(g.hs!=null&&g.close!=null&&g.modelLine!=null){xs.push(g.modelLine-g.close);ys.push((g.hs-g.as)-g.close);}}));
  if(xs.length>=8){const mx=xs.reduce((a,x)=>a+x,0)/xs.length,my=ys.reduce((a,x)=>a+x,0)/ys.length;let sxy=0,sxx=0;xs.forEach((x,i)=>{sxy+=(x-mx)*(ys[i]-my);sxx+=(x-mx)*(x-mx);});c.ic=sxx?parseFloat((sxy/sxx).toFixed(3)):null;c.nIc=xs.length;}
  // O/U scalar: graded analyzed games with a model total
  let at=0,mt=0,n=0;
  (history||[]).forEach(b=>{if(b.hs!=null&&b.modelOU){at+=b.hs+b.as;mt+=b.modelOU;n++;}});
  if(n&&mt>0){const r=at/mt;c.nOu=n;c.ouScalar=parseFloat((1+(r-1)*n/(n+CALIB_PRIOR_N)).toFixed(3));}
  // QB multiplier: graded analyzed games with QB injury value; pick m minimizing squared error
  const qg=(history||[]).filter(b=>b.hs!=null&&b.game&&b.game.baseLine!=null&&((b.game.hQb||0)+(b.game.aQb||0))>0);
  c.nQb=qg.length;
  if(qg.length>=5){
    let best=1,bestE=Infinity;
    [1,1.5,2,2.5,3].forEach(m=>{
      const e=qg.reduce((a,b)=>{const g=b.game;const line=g.baseLine-((g.hQb||0)*m+(g.hOther||0))+((g.aQb||0)*m+(g.aOther||0));return a+Math.pow((b.hs-b.as)-line,2);},0);
      if(e<bestE){bestE=e;best=m;}
    });
    c.qbMult=best;
  }
  return c;
}

function clvOf(side,posted,close){
  if(side==null||posted==null||close==null)return null;
  return parseFloat(((close-posted)*(side==="home"?1:-1)).toFixed(1));
}

function clvOuOf(take,posted,close){
  if(!take||posted==null||close==null)return null;
  const t=take.toUpperCase();if(t!=="OVER"&&t!=="UNDER")return null;
  return parseFloat(((close-posted)*(t==="OVER"?1:-1)).toFixed(1));
}

const SEASON_START_2026=new Date("2026-09-08T00:00:00");

function currentNflWeek(){
  const w=Math.floor((Date.now()-SEASON_START_2026.getTime())/(7*24*3600*1000))+1;
  return Math.min(18,Math.max(1,w));
}

function gradeSide(margin,spread,side){
  // margin = home score - away score; spread = home favored by (home-margin space); side = "home"|"away"
  if(margin===spread)return "P";
  const homeCovers=margin>spread;
  return (side==="home")===homeCovers?"W":"L";
}

function betSideOf(rec){
  if(!rec)return null;
  const r=rec.toUpperCase();
  if(r.includes("NO BET"))return null;
  if(r.includes("TAKE HOME")||r.includes("FADE AWAY"))return "home";
  if(r.includes("TAKE AWAY")||r.includes("FADE HOME"))return "away";
  return null;
}

function tgpl(hR,aR,hs,as,hi,ai,hfa){
  const net=hs-as;
  const hT=net+aR+(hi-ai)-hfa;
  const aT=-net+hR+(ai-hi)+hfa;
  return{nH:parseFloat((0.9*hR+0.1*hT).toFixed(2)),nA:parseFloat((0.9*aR+0.1*aT).toFixed(2))};
}

function ratingSuggestion(b,ratings,hfa){
  if(b.hs==null||b.as==null)return null;
  const hR=ratings[b.game?.home],aR=ratings[b.game?.away];
  if(hR==null||aR==null)return null;
  const net=b.hs-b.as;
  const hi=b.game?.hInjPts||0,ai=b.game?.aInjPts||0;
  const H=hfa!=null?hfa:HOME_ADV;
  const hT=net+aR+(hi-ai)-H;
  const aT=-net+hR+(ai-hi)+H;
  return{
    home:b.game.home,away:b.game.away,hR,aR,
    nH:parseFloat((0.9*hR+0.1*hT).toFixed(2)),
    nA:parseFloat((0.9*aR+0.1*aT).toFixed(2)),
  };
}
