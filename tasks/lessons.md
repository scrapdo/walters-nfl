# Lessons

Patterns worth remembering, written after a correction. Read this before
touching the model math.

## Injuries: ask who takes the snaps, not who is next on the list

**Reported:** "the ratings are weighing players that don't even play. for
instance, in this week's raiders game, Aidan O'Connell QB is factored in, but
he is unlikely to ever play, as the 3rd string QB."

**Root cause:** `calcInjuryDelta` searched for a replacement only below the
injured player in the depth chart. A third-stringer has nobody below him, so
the replacement value came back zero and the model charged his entire value.
Separately, a starter was compared to his direct backup instead of to the man
who actually enters the lineup, which undercharged every multi-starter
position.

**The generalizable mistake:** framing an injury as "who backs this player up"
instead of "how does the lineup on the field change." The first question has a
plausible-looking answer for every player on the report, including players
whose absence changes nothing. The second question answers itself.

**Rule:** any change to injury or personnel weighting must be expressed as a
difference between two lineups, not as a lookup on one player. Compute expected
on-field value with everyone healthy, compute it again with the report applied,
and take the difference. If a proposed formula can charge a player who was
never going to take a snap, it is wrong.

**Test before shipping:** a third-stringer behind healthy starters must price
at exactly 0.00. A starter must price against the player who enters the
lineup, not against his direct backup. The per-player numbers must sum to the
position total.

## The same function lived in two files

`engine.js` and `classic.html` each carried a byte-identical copy of
`calcInjuryDelta`. Fixing one left the other wrong. After changing shared model
math, grep for the function name across every html file and verify the copies
agree on real data, not just that they both parse.

## A stored AI read can outlive the numbers it argued from

`reads.json` entries recorded `line: 6.77` and reasoned explicitly from a
3.19 point injury hit. After the fix the card said 3.60 and 0.00, while the
read below it still argued the old case. Any cached narrative must carry the
inputs it was written against and be suppressed when those inputs move. The
board now drops a read once its line or market has shifted half a point.

## Zero needs a reason on screen

Showing `0.00` next to an injured player's name looks like a bug, which is how
this was found. When a value is deliberately zero, the interface should say
why: "behind healthy starters, not expected to play."
