#!/usr/bin/env python3
"""
Walters player-value pipeline.
Builds the app's PLAYER DATA import JSON from free nflverse data (QB EPA/dropback, DL pressures,
DB coverage, OL continuity, team unit ratings) or from a PFF grades export.

Usage:
  python3 player_pipeline.py --season 2025 --through-week 18 [--pff pff_export.csv] > players_2025.json
  Paste the JSON into the app: Analyze tab -> PLAYER DATA -> IMPORT.

Free-data sources (auto-downloaded from nflverse-data GitHub releases):
  play_by_play_{season}.csv.gz      QB EPA per dropback
  advstats_week_def_{season}.csv    per-defender pressures, targets, yards allowed
  snap_counts_{season}.csv          who played (offense/defense %)
  stats_team_week_{season}.csv      dropbacks for rates

Evidence (2018-2025 tests): pass-rush vs protection is ADDITIVE (no interaction term); protection
weakness drives pressure rate more than rush strength (0.72 vs 0.44); individual and unit DL
ratings predict equally, so unit rating + individual availability is used; OL continuity effect is
small (+0.2 pts pressure rate per missing usual starter); QB value ~13-21 pts of spread per EPA/db.
"""
import argparse, io, json, sys, urllib.request, gzip
import pandas as pd, numpy as np

BASE="https://github.com/nflverse/nflverse-data/releases/download/"
ABBR={'ARI':'Arizona Cardinals','ATL':'Atlanta Falcons','BAL':'Baltimore Ravens','BUF':'Buffalo Bills','CAR':'Carolina Panthers','CHI':'Chicago Bears','CIN':'Cincinnati Bengals','CLE':'Cleveland Browns','DAL':'Dallas Cowboys','DEN':'Denver Broncos','DET':'Detroit Lions','GB':'Green Bay Packers','HOU':'Houston Texans','IND':'Indianapolis Colts','JAX':'Jacksonville Jaguars','KC':'Kansas City Chiefs','LV':'Las Vegas Raiders','LAC':'Los Angeles Chargers','LA':'Los Angeles Rams','LAR':'Los Angeles Rams','MIA':'Miami Dolphins','MIN':'Minnesota Vikings','NE':'New England Patriots','NO':'New Orleans Saints','NYG':'New York Giants','NYJ':'New York Jets','PHI':'Philadelphia Eagles','PIT':'Pittsburgh Steelers','SF':'San Francisco 49ers','SEA':'Seattle Seahawks','TB':'Tampa Bay Buccaneers','TEN':'Tennessee Titans','WAS':'Washington Commanders','WSH':'Washington Commanders'}

def fetch(path, gz=False):
    with urllib.request.urlopen(BASE+path) as r:
        data=r.read()
    if gz: data=gzip.decompress(data)
    return pd.read_csv(io.BytesIO(data), low_memory=False)

def shrink(num, den, prior, k):
    return (num + prior*k)/(den + k)

def build_free(season, thru):
    tw=fetch(f"stats_team/stats_team_week_{season}.csv"); tw=tw[(tw.season_type=='REG')&(tw.week<=thru)].copy()
    tw['db']=tw.attempts+tw.sacks_suffered.fillna(0); tw['team']=tw.team.map(ABBR); tw['opp']=tw.opponent_team.map(ABBR)
    pf=fetch(f"pfr_advstats/advstats_week_def_{season}.csv"); pf=pf[(pf.game_type=='REG')&(pf.week<=thru)].copy()
    pf['team']=pf.team.map(ABBR); pf['opp']=pf.opponent.map(ABBR)
    sn=fetch(f"snap_counts/snap_counts_{season}.csv"); sn=sn[(sn.game_type=='REG')&(sn.week<=thru)].copy(); sn['team']=sn.team.map(ABBR)
    pbp=fetch(f"pbp/play_by_play_{season}.csv.gz", gz=True)
    pbp=pbp[(pbp.season_type=='REG')&(pbp.week<=thru)&(pbp.qb_dropback==1)&pbp.passer_player_id.notna()&pbp.epa.notna()]
    pbp['team']=pbp.posteam.map(ABBR)

    # ---- team unit ratings: pass rush R (pressure rate generated), protection P (pressure rate allowed) ----
    tp=pf.groupby(['week','team','opp']).def_pressures.sum().reset_index(name='pres')
    d=tp.merge(tw.rename(columns={'team':'opp','opp':'team','db':'opp_db'})[['week','team','opp','opp_db']],on=['week','team','opp'])
    LG=d.pres.sum()/max(1,d.opp_db.sum())
    R={}; P={}
    for t in ABBR.values():
        g=d[d.team==t]; R[t]=round(float(shrink(g.pres.sum(),g.opp_db.sum(),LG,120)-LG),4)
        a=d[d.opp==t]; P[t]=round(float(shrink(a.pres.sum(),a.opp_db.sum(),LG,120)-LG),4)
    # opponent adjustment (one pass)
    for t in list(R):
        faced=d[d.team==t].opp.map(P).mean() if len(d[d.team==t]) else 0
        R[t]=round(R[t]-(faced if faced==faced else 0),4)
    for t in list(P):
        faced=d[d.opp==t].team.map(R).mean() if len(d[d.opp==t]) else 0
        P[t]=round(P[t]-(faced if faced==faced else 0),4)

    players={}
    def add(team,name,pos,idx,sample,src):
        players.setdefault(team,[]).append({"n":name,"p":pos,"idx":round(float(idx),2),"smp":int(sample),"src":src})

    # ---- QB: EPA per dropback, shrunk (k=150), index = z vs league QB distribution ----
    q=pbp.groupby(['team','passer_player_name']).agg(db=('epa','size'),epa=('epa','sum')).reset_index()
    LQ=pbp.epa.sum()/len(pbp)
    q['v']=shrink(q.epa,q.db,LQ,150)
    sdq=q[q.db>=100].v.std() or 0.06
    for r in q[q.db>=20].itertuples(): add(r.team,r.passer_player_name,'QB',(r.v-LQ)/sdq,r.db,'nflverse')

    # ---- DL/EDGE: pressure rate per approx pass-rush snap, shrunk (k=80) ----
    pl=pf.merge(sn[['season','week','pfr_player_id','defense_pct','position']],on=['season','week','pfr_player_id'],how='left')
    pl=pl.merge(tw.rename(columns={'team':'opp','opp':'team','db':'opp_db'})[['week','team','opp','opp_db']],on=['week','team','opp'])
    pl['opps']=pl.defense_pct.fillna(0)*pl.opp_db
    rush=pl[pl.position.isin(['DE','DT','NT','OLB','EDGE','DL','LB'])].groupby(['team','pfr_player_name','position']).agg(pres=('def_pressures','sum'),opps=('opps','sum')).reset_index()
    rush=rush[rush.opps>=40]; rush['v']=shrink(rush.pres,rush.opps,LG*0.25,80)   # ~quarter of team pressure rate per rusher baseline
    base=LG*0.25; sdr=rush.v.std() or 0.02
    for r in rush.itertuples(): add(r.team,r.pfr_player_name,'EDGE' if r.position in('DE','OLB','EDGE') else ('DT' if r.position in('DT','NT','DL') else 'LB'),(r.v-base)/sdr,r.opps,'nflverse')

    # ---- DB coverage: yards allowed per target, shrunk (k=40); lower is better -> negate ----
    cov=pl[pl.position.isin(['CB','S','FS','SS','DB'])].groupby(['team','pfr_player_name','position']).agg(tg=('def_targets','sum'),yd=('def_yards_allowed','sum'),snaps=('opps','sum')).reset_index()
    cov=cov[cov.tg>=8]; LY=cov.yd.sum()/max(1,cov.tg.sum()); cov['ypt']=shrink(cov.yd,cov.tg,LY,40)
    sdc=cov.ypt.std() or 1.5
    for r in cov.itertuples(): add(r.team,r.pfr_player_name,'CB' if r.position=='CB' else 'S',-(r.ypt-LY)/sdc,r.tg,'nflverse')

    # ---- OL continuity: usual starters (early-season top-5 by snap %) and who has been missing lately ----
    ol=sn[sn.position.isin(['T','G','C','OT','OG','OL'])]
    olinfo={}
    for t,g in ol.groupby('team'):
        early=g[g.week<=3].groupby('pfr_player_id').offense_pct.mean().sort_values(ascending=False).head(5).index
        last=g[g.week==g.week.max()]; playing=set(last[last.offense_pct>=0.5].pfr_player_id)
        olinfo[t]={"usual":int(len(early)),"missing_last_week":int(len([p for p in early if p not in playing]))}

    return {"season":season,"through_week":thru,"source":"nflverse+pfr","league_pressure_rate":round(float(LG),4),
            "units":{t:{"R":R.get(t,0),"P":P.get(t,0),"ol":olinfo.get(t,{})} for t in ABBR.values()},
            "players":players,
            "notes":"idx = standard deviations above position average (0 = average, +2 = elite, -2 = replacement). Effective value = base x (1 + 0.25 x idx), clamped 0.2x-2.0x. Matchup: DL/EDGE game value += 12 x opponent P; OL unit value -= 12 x opponent R (additive, tested)."}

# ---------------- ESPN win rates (tracking-derived; independent of PFF charting) ----------------
# ESPN blocks scripted fetches. Save the rankings page from your browser (Ctrl+S, "Webpage, complete" or
# copy the page text into a .txt) and pass --espn FILE. Published format: "N. Team Name, XX%" under
# "Team pass rush / run stop / pass block / run block win rate", and top-10 player lists per position.
# NOTE: ESPN re-formulated win rates for 2026 (survival/time-based). Do not mix pre-2026 values with 2026 values.
import re, html as _html
ESPN_TEAM_HEADS={'team pass rush win rate':'prwr','team run stop win rate':'rswr','team pass block win rate':'pbwr','team run block win rate':'rbwr'}
ESPN_PLAYER_HEADS=[('pass block win rate','pbwr'),('run block win rate','rbwr'),('pass rush win rate','prwr'),('run stop win rate','rswr')]
ESPN_POS={'OT':'OT','OG':'G','C':'C','DE/OLB':'EDGE','DE':'EDGE','OLB':'EDGE','DT':'DT','EDGE':'EDGE','IDL':'DT'}
ESPN_TABLE_HEAD=re.compile(r'^(edge|dt|ot|iol|og|c|de/olb)\s+(pass rush|pass block|run stop|run block)\s+win rate\s+rankings?$')
ESPN_TABLE_ROW=re.compile(r'^(\d+)\s+(.+?)\s+([A-Z]{2,3})\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)%\s+\d+(?:\.\d+)?%?$')
ESPN_TEAM_ROW=re.compile(r'^(.+?)\s+(\d+)%\s*\(\d+\)\s+(\d+)%\s*\(\d+\)\s+(\d+)%\s*\(\d+\)\s+(\d+)%\s*\(\d+\)$')
ESPN_METRIC={'pass rush':'prwr','pass block':'pbwr','run stop':'rswr','run block':'rbwr'}
ESPN_TPOS={'edge':'EDGE','de/olb':'EDGE','dt':'DT','ot':'OT','iol':'G','og':'G','c':'C'}
def parse_espn(text):
    t=_html.unescape(re.sub(r'<[^>]+>','\n',text)); lines=[re.sub(r'\s+',' ',l).strip() for l in t.split('\n')]
    teams={}; players=[]; sec=None; kind=None; pos=None
    for ln in lines:
        low=ln.lower()
        if not ln: continue
        # ---- 2025+ table format: "Edge Pass Rush Win Rate Rankings" then rows "1 Nick Herbig PIT 45 180 25% 12%"
        m=ESPN_TABLE_HEAD.match(low)
        if m: pos=ESPN_TPOS[m.group(1)]; sec=ESPN_METRIC[m.group(2)]; kind='table'; continue
        if low.startswith('nfl team win rate rankings') or low.startswith('team prwr'): kind='teamtable'; sec=None; continue
        if kind=='table':
            m=ESPN_TABLE_ROW.match(ln)
            if m:
                players.append({"n":m.group(2),"team":ABBR.get(m.group(3),m.group(3)),"p":pos,"metric":sec,"pct":float(m.group(6)),"rank":int(m.group(1)),"wins":int(m.group(4)),"plays":int(m.group(5))}); continue
        if kind=='teamtable':
            m=ESPN_TEAM_ROW.match(ln)
            if m:
                name=ABBR.get(m.group(1),m.group(1)); teams[name]={"prwr":float(m.group(2)),"rswr":float(m.group(3)),"pbwr":float(m.group(4)),"rbwr":float(m.group(5))}; continue
        # ---- pre-2023 numbered-list format
        hit=[k for k in ESPN_TEAM_HEADS if low.startswith(k)]
        if hit: sec=ESPN_TEAM_HEADS[hit[0]]; kind='team'; continue
        m=re.match(r'top\s*\d+\s+([A-Za-z/]+)\s+(.*win rate)',low)
        if m:
            pos=ESPN_POS.get(m.group(1).upper(),m.group(1).upper()); sec=next((v for k,v in ESPN_PLAYER_HEADS if k in m.group(2)),None); kind='player'; continue
        m=re.match(r'^(\d+)\.\s*(.+?)\s*(\d+(?:\.\d+)?)%\s*$',ln)
        if not (m and sec): continue
        rank=int(m.group(1)); body=m.group(2).rstrip(',:; '); pct=float(m.group(3))
        parts=[x.strip() for x in re.split(r',|\(|\)|:',body) if x.strip()]
        if kind=='team':
            name=ABBR.get(parts[0],parts[0]); teams.setdefault(name,{})[sec]=pct
        else:
            name=parts[0]; team=parts[1] if len(parts)>1 else None
            if team: team=ABBR.get(team,team)
            players.append({"n":name,"team":team,"p":pos,"metric":sec,"pct":pct,"rank":rank})
    return {"teams":teams,"players":players}

def merge_espn(out, espn):
    """Blend ESPN team win rates into units (provenance kept) and add top-10 individuals with rank-based idx."""
    units=out.setdefault('units',{})
    # team z-scores across the 32 for each metric
    for metric in ['prwr','rswr','pbwr','rbwr']:
        vals={t:v[metric] for t,v in espn['teams'].items() if metric in v}
        if len(vals)<16: continue
        arr=np.array(list(vals.values())); m,s=arr.mean(),arr.std() or 1
        for t,v in vals.items():
            u=units.setdefault(t,{"R":0,"P":0,"ol":{}})
            u.setdefault('espn',{})[metric]=v; u['espn'][metric+'_z']=round(float((v-m)/s),2)
    # blend into R/P in pressure-rate units: scale ESPN z by the cross-team SD of the nflverse rating
    Rs=np.array([u.get('R',0) for u in units.values()]); Ps=np.array([u.get('P',0) for u in units.values()])
    sR=Rs.std() or 0.02; sP=Ps.std() or 0.02
    for t,u in units.items():
        e=u.get('espn',{})
        if 'prwr_z' in e:
            u['R_nflverse']=u.get('R',0); u['R_espn']=round(float(e['prwr_z']*sR),4); u['R']=round(0.5*u['R_nflverse']+0.5*u['R_espn'],4)
        if 'pbwr_z' in e:
            u['P_nflverse']=u.get('P',0); u['P_espn']=round(float(-e['pbwr_z']*sP),4); u['P']=round(0.5*u['P_nflverse']+0.5*u['P_espn'],4)   # high PBWR = LOW protection weakness
    # individuals: only the top-N per list are published -> rank-based index (rank 1 = +2.5 ... rank 10 = +1.8 ... rank 20 = +1.0).
    # A player on several lists (e.g. DT pass rush AND run stop) is merged ONCE: mean of his rank-indexes, every metric kept.
    grouped={}
    for pl in espn['players']:
        if not pl['team']: continue
        g=grouped.setdefault((pl['team'],_key(pl['n'])),{"n":pl['n'],"p":pl['p'],"team":pl['team'],"idxs":[],"espn":{},"plays":0})
        g['idxs'].append(1.0+(20-min(pl['rank'],20))/19.0*1.5); g['espn'][pl['metric']]=pl['pct']; g['espn'][pl['metric']+'_rank']=pl['rank']; g['plays']=max(g['plays'],pl.get('plays',0))
    for g in grouped.values():
        idx=round(sum(g['idxs'])/len(g['idxs']),2)
        lst=out.setdefault('players',{}).setdefault(g['team'],[])
        ex=next((x for x in lst if _same(x['n'],g['n'])),None)
        if ex:
            ex['idx']=round((ex['idx']+idx)/2,2); ex['src']=(ex.get('src','')+'+espn') if 'espn' not in ex.get('src','') else ex['src']; ex['espn']=g['espn']
        else:
            lst.append({"n":g['n'],"p":g['p'],"idx":idx,"smp":g['plays'],"src":"espn","espn":g['espn']})
    out['sources']=out.get('sources',[out.get('source','nflverse+pfr')])+['espn']
    return out

def _key(n):
    s=re.sub(r'[^a-z .]','',(n if isinstance(n,str) else '').lower()); s=re.sub(r'\b(jr|sr|ii|iii|iv)\b','',s).strip(); p=[x for x in re.split(r'[ .]+',s) if x]
    return (p[0][0]+'|'+p[-1]) if p else ''
def _same(a,b): return _key(a)==_key(b)

def add_run_units(out, season, thru):
    """Run-game unit metrics from play-by-play: rush success rate for offense and allowed by defense (shrunk k=60)."""
    pbp=fetch(f"pbp/play_by_play_{season}.csv.gz", gz=True)
    r=pbp[(pbp.season_type=='REG')&(pbp.week<=thru)&(pbp.play_type=='run')&pbp.success.notna()].copy()
    r['team']=r.posteam.map(ABBR); r['def']=r.defteam.map(ABBR); LS=r.success.mean()
    for t in ABBR.values():
        o=r[r.team==t]; d=r[r['def']==t]
        u=out.setdefault('units',{}).setdefault(t,{"R":0,"P":0,"ol":{}})
        u['run']={"rushO_succ":round(float(shrink(o.success.sum(),len(o),LS,60)),3),"rushD_succ":round(float(shrink(d.success.sum(),len(d),LS,60)),3),"league":round(float(LS),3)}
    return out

def build_pff(csv_path, season, thru):
    pf=pd.read_csv(csv_path)
    # expected columns (PFF premium export): player, team_name (or team), position, grades_offense / grades_defense / grades_pass_rush / grades_coverage ...
    cols={c.lower():c for c in pf.columns}
    name=cols.get('player') or cols.get('player_name'); team=cols.get('team_name') or cols.get('team'); pos=cols.get('position')
    grade=None
    for k in ['grades_pass_rush','grades_coverage','grades_pass_block','grades_offense','grades_defense','grade','overall_grade']:
        if k in cols: grade=cols[k]; break
    if not (name and team and pos and grade): sys.exit("PFF export needs player, team, position and a grade column; found: "+", ".join(pf.columns))
    players={}
    for r in pf.itertuples():
        t=getattr(r,team); t=ABBR.get(t,t)
        g=float(getattr(r,grade)); idx=(g-60)/10.0    # PFF: 60 average, 70 good, 80+ elite, 90 rare -> idx +3 at 90
        players.setdefault(t,[]).append({"n":getattr(r,name),"p":getattr(r,pos),"idx":round(idx,2),"smp":int(getattr(r,cols['snap_counts_offense'],0) if 'snap_counts_offense' in cols else 0),"src":"pff"})
    return {"season":season,"through_week":thru,"source":"pff","units":{},"players":players,"notes":"idx = (PFF grade - 60)/10"}

if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("--season",type=int,required=True); ap.add_argument("--through-week",type=int,default=18)
    ap.add_argument("--pff",help="PFF grades export CSV"); ap.add_argument("--espn",help="saved ESPN win-rates page (.html or .txt)"); ap.add_argument("--no-run",action="store_true",help="skip run-game units (saves the pbp download)")
    a=ap.parse_args()
    out=build_pff(a.pff,a.season,a.through_week) if a.pff else build_free(a.season,a.through_week)
    if not a.no_run and not a.pff: out=add_run_units(out,a.season,a.through_week)
    if a.espn: out=merge_espn(out,parse_espn(open(a.espn,encoding='utf-8',errors='ignore').read()))
    print(json.dumps(out))
