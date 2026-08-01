# Why it is built like this

The decisions somebody would otherwise have to reconstruct from the code, and
what they cost.

## Integers everywhere

Heights and depths are centimetres, money is cents, time is minutes since the
epoch. Nothing in a record is a float.

The reason is not precision in the abstract, it is that two people reading the
same record have to get the same answer. A tide height of 2.34 metres held as a
float compares unequal to itself after a round trip through json, and a clearance
that is short by a hundredth of a millimetre reads as short. The cost is a
conversion at every edge, and a `formatMetres` call in every report.

## The domain does not know there is a database

Everything under `src/domain` is functions over plain objects. The stores map
rows to those objects and back, and the services are the only things that hold
both a database handle and a rule.

That is what lets the tide, the clearance and the tariff be tested without a
file, which is most of the suite. It costs a mapping layer that has to be kept
in step, and the check that catches drift is that the store runs the domain
constructor on the way out as well as on the way in: a row written by an older
version has to satisfy today's rules or the load fails loudly.

## The sweep is a set intersection, not a search

Each constraint answers "when is this reach passable" as a set of intervals, they
are moved back along the passage by the time it takes to get there, and the
answer is the intersection. Nothing searches for a start time and then checks it.

It means a constraint can be added without touching the others, and a movement
with no window gets an answer that says which rule closed it rather than "none
found". The cost is that every constraint has to be expressible as intervals,
which is why the notices' speed cap changes the passage rather than filtering
the answer.

## Squat is computed from the water she is actually in

The obvious model has the ship needing a fixed depth. The real one has squat
depending on the water available, which depends on the tide, which is what the
sweep is deciding. So the assessment is run again at every state of tide, and
the inverse questions are bisections rather than rearrangements.

This is the single most expensive decision in the system, and it is the one that
makes the answers right on the reaches where it matters.

## The published tariff order is not the obvious one

Surcharges are percentages of the base and never of each other. Disbursements
take no surcharge. The agent's discount comes off the pilotage and the
surcharges but not off the disbursements, and detention is added after the
discount.

Nobody would guess that order and it changes the answer by a few percent, which
is exactly the size of error that goes unnoticed for a year. It is written down
in `assessMovement` in the order the tariff applies it, with a comment saying so.

## An issued invoice is never edited

Everything that would have changed it becomes a credit note with a reason code
and a ceiling. A dispute stops the chasing without changing a figure.

The auditors and the agents both expect the sequence to be complete and
unaltered, and a system that lets a number be corrected in place cannot answer
what it said last month.

## The board is not quietly rearranged

The assignment engine walks the turn board from the top and takes the first pilot
who clears the licence, the rest rules and leave. It never reorders to get a
better answer. A despatcher may override it, and the override is a separate act
with a reason that goes in the audit trail.

The board is the thing the pilots read most closely. A system that optimised it
would be a system they did not trust.

## Rule ids, and the handbook generated from them

Every finding carries an id like `UKC-NET-01`, generated into `docs/rules.md` and
readable from `keelroom explain`. An id in the source and not in the handbook is
a rule nobody outside can look up; an id in the handbook and not in the source is
a rule somebody is still being told about. Both fail the build.

## sqlite, and one file per district

A district is one file. It is backed up by copying it, moved by moving it, and
read by anything that can open sqlite. There is no server to run.

The cost is that two districts are two files and there is no cross district
query. Nothing in the domain has ever wanted one.
