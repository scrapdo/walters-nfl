# Walters NFL -- automated weekly pipeline

Nothing manual in season. GitHub Actions runs the pipeline on a schedule and deploys the site.

| when (ET)   | stage   | what happens |
|-------------|---------|--------------|
| Tue 9am     | tuesday | schedule, depth-chart rosters, player indices, team stats, opening lines, board, AI reads (flagged games) |
| Wed-Sat 6pm | daily   | injury reports (calibrated statuses), current lines, board, reads |
| Sun 11am    | close   | closing lines captured (CLV), final board |
| Mon 9am     | grade   | finals, model picks graded, CLV, TGPL re-rate of all 32, calibration + info coefficient |

Data sources: nflverse (schedule with neutral-site flags, depth charts, injuries, play-by-play, PFR charting,
snap counts), The Odds API (DK/FD/Caesars/MGM), Anthropic API (reads for flagged games only). ESPN win rates
are an optional enrichment done via browser (they block scripts):
`python3 pipeline/player_pipeline.py --season 2026 --espn saved_page.html`

Model math is the app's own code, extracted from `index.html` at run time (`pipeline/run.js`), so the automated
numbers and the on-screen numbers cannot drift.

Outputs in `data/`: week.json (inputs), lines.json (open/current/close per book), board.json (every game with
deltas, line, market, stars, pick, O/U), reads.json (AI reads), history.json (graded weeks), ratings.json,
calib.json.

Secrets (Settings -> Secrets and variables -> Actions): ODDS_API_KEY, ANTHROPIC_API_KEY, NETLIFY_AUTH_TOKEN.
Manual run: Actions -> walters-weekly -> Run workflow -> pick a stage.

Calibration notes: injury statuses come from 36,723 report lines (2015-25) matched to snap counts; HFA 2.0 and
TGPL 0.9/0.1 verified optimal across 11 seasons; star plays measure disagreement with the market, not edge --
watch the info coefficient and CLV before treating them as bets.
