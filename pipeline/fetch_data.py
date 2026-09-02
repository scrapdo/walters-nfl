#!/usr/bin/env python3
"""
Weekly data stage: schedule, depth-chart rosters with values, injury statuses (calibrated), player indices,
team stats, unit ratings -> data/week.json. Everything from nflverse; no LLM, no manual input.
  python3 pipeline/fetch_data.py --stage tuesday|daily
"""
import argparse, io, json, sys, os, urllib.request, gzip, datetime as dt
import pandas as pd, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import player_pipeline as pp

BASE="https://github.com/nflverse/nflverse-data/releases/download/"
GAMES="https://github.com/nflverse/nfldata/raw/master/data/games.csv"
ABBR=pp.ABBR
CODE={'ARI':'ARI','ATL':'ATL','BAL':'BAL','BUF':'BUF','CAR':'CAR','CHI':'CHI','CIN':'CIN','CLE':'CLE','DAL':'DAL','DEN':'DEN','DET':'DET','GB':'GB','HOU':'HOU','IND':'IND','JAX':'JAX','KC':'KC','LV':'LV','LAC':'LAC','LA':'LA','LAR':'LA','MIA':'MIA','MIN':'MIN','NE':'NE','NO':'NO','NYG':'NYG','NYJ':'NYJ','PHI':'PHI','PIT':'PIT','SF':'SF','SEA':'SEA','TB':'TB','TEN':'TEN','WAS':'WAS','WSH':'WAS'}

def fetch_csv(url, gz=False, optional=False):
    try:
        with urllib.request.urlopen(url) as r: data=r.read()
        if gz: data=gzip.decompress(data)
        return pd.read_csv(io.BytesIO(data), low_memory=False)
    except Exception as e:
        if optional: return None
        raise

# ---- position mapping: depth-chart abbreviations -> app positions; baseline Walters values by (family, rank) ----
FAM={'QB':'QB','RB':'RB','FB':'RB','WR':'WR','TE':'TE','LT':'OT','RT':'OT','LG':'G','RG':'G','C':'C','LDE':'EDGE','RDE':'EDGE','LDT':'DT','RDT':'DT','NT':'DT',
     'MLB':'LB','LILB':'LB','RILB':'LB','SLB':'LB','WLB':'LB','LCB':'CB','RCB':'CB','NB':'CB','FS':'S','SS':'S','PK':'K','P':'P','LS':'LS','KR':'ST','PR':'ST','H':'ST'}
BASE_VAL={'RB':[0.9,0.3,0.1],'WR':[1.6,1.0,0.5,0.15],'TE':[0.8,0.2,0.1],'OT':[1.1,0.9,0.25],'G':[0.6,0.6,0.2],'C':[0.6,0.2],'EDGE':[1.4,1.1,0.3],'DT':[0.8,0.6,0.2],
          'LB':[0.7,0.5,0.4,0.15],'CB':[1.2,0.9,0.5,0.15],'S':[0.7,0.5,0.15],'K':[0.3],'P':[0.1],'LS':[0.05],'ST':[0.05]}
QB_BACKUP=5.8

def current_week(games, today):
    up=games[(games.season==games.season.max())&games.result.isna()]
    if len(up): return int(up.week.min()), int(games.season.max())
    return int(games.week.max()), int(games.season.max())

def build_rosters(season, qb_seed, players):
    dc=fetch_csv(f"{BASE}depth_charts/depth_charts_{season}.csv")
    latest=dc[dc.dt==dc.dt.max()].copy()
    out={}
    for code,g in latest.groupby('team'):
        team=ABBR.get(CODE.get(code,code)); 
        if not team: continue
        rows=[]
        # 3-4 fronts label the two-gap ends LDE/RDE (interior) and the edge rushers SLB/WLB; 4-3 fronts are the reverse
        def fam_of(row):
            grp=str(row.pos_grp); ab=row.pos_abb
            if '3-4' in grp:
                if ab in ('LDE','RDE'): return 'DT'
                if ab in ('SLB','WLB'): return 'EDGE'
            return FAM.get(ab)
        g=g.assign(fam=[fam_of(r) for r in g.itertuples()])
        for fam in set(FAM.values()):
            sub=g[g.fam==fam].sort_values('pos_rank')
            seen=set(); rank=0
            for r in sub.itertuples():
                if not isinstance(r.player_name,str) or r.player_name in seen: continue
                seen.add(r.player_name); rank+=1
                if fam=='QB':
                    seed=qb_seed.get(team,{})
                    v=(seed.get('qb1',{}).get('v') if rank==1 else None) or (seed.get('qb2',{}).get('v') if rank==2 else None) or (QB_BACKUP if rank==2 else 5.5)
                    # QB seed names may differ from depth chart names: trust the depth chart for WHO, the seed for VALUE only when names match
                    sn=(seed.get('qb1' if rank==1 else 'qb2',{}) or {}).get('n','')
                    if sn and pp._key(sn)!=pp._key(r.player_name): v=QB_BACKUP if rank>=2 else 6.8
                else:
                    tbl=BASE_VAL.get(fam,[0.1]); v=tbl[min(rank,len(tbl))-1]
                rows.append({"n":r.player_name,"p":fam,"d":rank,"v":round(float(v),2)})
        out[team]=rows
    return out, str(latest.dt.max())

def attach_perf(rosters, players):
    # performance follows the player: same-team match first, then any team (offseason moves)
    allp={}
    for t,lst in players.get('players',{}).items():
        for x in lst: allp.setdefault(pp._key(x['n']),[]).append(x)
    for team,rows in rosters.items():
        lst=players.get('players',{}).get(team,[])
        for p in rows:
            h=next((x for x in lst if pp._same(x['n'],p['n'])),None)
            if not h:
                cands=allp.get(pp._key(p['n']),[])
                if len(cands)==1 or (cands and len({c.get('p') for c in cands})==1): h=cands[0]
            if not h: p['ev']=p['v']; p['idx']=None; continue
            p['idx']=h['idx']; p['src']=h.get('src'); p['smp']=h.get('smp',0)
            if p['p']=='QB':
                p['ev']=round((p['v']+min(9.5,max(5.0,7.74+0.85*h['idx'])))/2,2) if h.get('smp',0)>=60 else p['v']
            else:
                p['ev']=round(p['v']*min(2,max(0.2,1+0.25*h['idx'])),2)
    return rosters

def calibrated_status(report, practice, pos):
    if report in ('Out','Doubtful'): return 'OUT'
    if report=='Questionable':
        if practice=='DNP': return 'Q55'
        if practice=='LP': return 'Q55' if pos=='QB' else 'Q30'
        return 'Q15'
    if practice=='DNP': return 'Q15'
    return 'IN'

def build_injuries(season, week):
    inj=fetch_csv(f"{BASE}injuries/injuries_{season}.csv", optional=True)
    if inj is None: return {}, "no injury file yet"
    inj=inj[(inj.game_type=='REG')&(inj.week==week)]
    pmap={'Did Not Participate In Practice':'DNP','Limited Participation in Practice':'LP','Full Participation in Practice':'FP'}
    out={}
    for r in inj.itertuples():
        team=ABBR.get(CODE.get(r.team,r.team)); 
        if not team: continue
        st=calibrated_status(r.report_status if isinstance(r.report_status,str) else None, pmap.get(r.practice_status), r.position)
        if st!='IN': out.setdefault(team,{})[r.full_name]={"status":st,"report":r.report_status if isinstance(r.report_status,str) else None,"practice":pmap.get(r.practice_status),"injury":r.report_primary_injury if isinstance(r.report_primary_injury,str) else (r.practice_primary_injury if isinstance(r.practice_primary_injury,str) else None)}
    return out, f"{len(inj)} report lines"

def build_teamstats(season, thru):
    tw=fetch_csv(f"{BASE}stats_team/stats_team_week_{season}.csv", optional=True)
    src=season
    if tw is None or len(tw[(tw.season_type=='REG')&(tw.week<=thru)])<48:   # <3 games per team -> prior season
        tw=fetch_csv(f"{BASE}stats_team/stats_team_week_{season-1}.csv"); src=season-1; thru=99
    tw=tw[(tw.season_type=='REG')&(tw.week<=thru)]
    g=fetch_csv(GAMES); g=g[(g.season==src)&(g.game_type=='REG')&g.result.notna()]
    pts={}
    for r in g.itertuples():
        h=ABBR.get(CODE.get(r.home_team,r.home_team)); a=ABBR.get(CODE.get(r.away_team,r.away_team))
        if not h or not a: continue
        pts.setdefault(h,{'pf':[],'pa':[]}); pts.setdefault(a,{'pf':[],'pa':[]})
        pts[h]['pf'].append(r.home_score); pts[h]['pa'].append(r.away_score); pts[a]['pf'].append(r.away_score); pts[a]['pa'].append(r.home_score)
    return {t:{"off":round(float(np.mean(v['pf'])),1),"def":round(float(np.mean(v['pa'])),1),"n":len(v['pf'])} for t,v in pts.items()}, src

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--stage",default="daily"); ap.add_argument("--out",default="data/week.json"); ap.add_argument("--season",type=int); ap.add_argument("--week",type=int)
    a=ap.parse_args()
    today=dt.date.today()
    games=fetch_csv(GAMES)
    week,season=current_week(games,today)
    if a.stage=='grade':   # grade the most recent week that has results
        done=games[(games.season==season)&(games.game_type=='REG')&games.result.notna()]
        if len(done): week=int(done.week.max())
    if a.season: season=a.season
    if a.week: week=a.week
    sched=games[(games.season==season)&(games.week==week)]
    gl=[]
    for r in sched.itertuples():
        h=ABBR.get(CODE.get(r.home_team,r.home_team)); aw=ABBR.get(CODE.get(r.away_team,r.away_team))
        gl.append({"id":r.game_id,"away":aw,"home":h,"gameday":r.gameday,"gametime":r.gametime,"neutral":str(r.location).lower()=="neutral",
                   "ref_spread":(None if pd.isna(r.spread_line) else float(r.spread_line)),"ref_total":(None if pd.isna(r.total_line) else float(r.total_line)),
                   "result":(None if pd.isna(r.result) else float(r.result)),"home_score":(None if pd.isna(r.home_score) else int(r.home_score)),"away_score":(None if pd.isna(r.away_score) else int(r.away_score))})
    # player indices: current season if 3+ weeks of data exist, else prior season
    thru=max(0,week-1)
    try:
        players=pp.build_free(season,thru) if thru>=3 else pp.build_free(season-1,18)
        players=pp.add_run_units(players,players['season'],players['through_week'])
        psrc=f"{players['season']} thru wk {players['through_week']}"
    except Exception as e:
        players={"players":{},"units":{}}; psrc="unavailable: "+str(e)
    qb_seed=json.load(open(os.path.join(os.path.dirname(__file__),'qb_seed.json')))
    rosters,dc_date=build_rosters(season,qb_seed,players)
    rosters=attach_perf(rosters,players)
    injuries,inj_note=build_injuries(season,week)
    teamstats,ts_src=build_teamstats(season,thru)
    out={"season":season,"week":week,"generated":dt.datetime.utcnow().isoformat()+"Z","stage":a.stage,
         "sources":{"schedule":"nflverse nfldata games.csv","depth_chart":dc_date,"injuries":inj_note,"players":psrc,"teamstats":f"season {ts_src}"},
         "games":gl,"rosters":rosters,"injuries":injuries,"teamstats":teamstats,"units":players.get('units',{}),
         "league_pressure_rate":players.get('league_pressure_rate',0.247)}
    os.makedirs(os.path.dirname(a.out),exist_ok=True)
    def clean(o):   # NaN is not JSON
        if isinstance(o,float) and o!=o: return None
        if isinstance(o,dict): return {k:clean(v) for k,v in o.items()}
        if isinstance(o,list): return [clean(v) for v in o]
        return o
    json.dump(clean(out),open(a.out,'w'),allow_nan=False)
    print(f"week {week} {season}: {len(gl)} games, {sum(len(v) for v in rosters.values())} roster spots, injuries: {inj_note}, players: {psrc}, teamstats: {ts_src}")

if __name__=="__main__": main()
