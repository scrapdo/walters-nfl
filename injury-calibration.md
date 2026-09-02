# Injury status calibration (nflverse injury reports x snap counts, 2015-2025)
36,723 report lines for regulars (players normally at 50%+ of snaps). "Loss" = 1 - E[snap fraction of usual] / 0.878,
where 0.878 is the healthy baseline (regulars with no designation and full practice still average 87.8% of usual snaps).

final status + last practice   n      P(played)   value loss   app assumed before
Out + DNP                   5517       0.5%        99.5%       100%
Doubtful + DNP               854       2.2%        98.4%        75%   <- Doubtful is Out
Doubtful + Limited           250       1.2%        99.0%        75%
Questionable + DNP          1565      47.7%        54.0%        50%
Questionable + Limited      6200      73.1%        29.5%        25%
Questionable + Full         1731      87.6%        14.5%        25%
no designation + DNP        1921      83.8%        11.9%         0%   <- was ignored
no designation + Limited    2473      96.0%         1.3%         0%
Standard errors on the Questionable groups: 0.6-1.3 points.

Questionable by position (loss):   DNP    Limited   Full
  QB                                --      52%      13%     (a Questionable QB after limited practice is a coin flip)
  OL                               60%      28%      14%
  WR/TE                            51%      27%      11%
  RB                               65%      31%      21%
  DL/EDGE                          43%      20%      11%
  LB                               44%      28%      16%
  DB                               60%      36%      17%
Questionable+Limited play rate is stable 2015-2025 (68-80%, no trend).

App changes:
- Status levels are now Q15 / Q30 / Q55 / OUT (Doubtful -> OUT). Practice-report suggestions: Q+DNP -> Q55, Q+Limited -> Q30
  (QB -> Q55), Q+Full -> Q15, no-tag DNP -> Q15.
- Q losses are now net of the backup (loss = pct x (player value - replacement value)), the same treatment as OUT --
  previously a Questionable starter's full value was charged with no credit for whoever fills the snaps.
- The practice-report fetch now includes players with no game designation, since their DNP still costs ~12%.
Not tested here: whether the market already prices these statuses (needs line-movement history).
