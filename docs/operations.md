# Running a district

This is the operator's page. It assumes the district file exists; see the README
for how to build one.

## Every morning

```
keelroom bulletin
keelroom doctor --deep
```

The bulletin is the page read at the eight o'clock meeting: the tide, the
weather the plans are being made against, the notices in force, what is expected
today, and the top of the board. The doctor is the list of things that are about
to go wrong: a window that has closed under a movement that was confirmed on it,
a survey old enough that most of the planned depth is allowance, a berth booked
twice, a licence running out.

`--deep` replans every confirmed movement, which takes a few seconds and is
worth doing once a day.

## Taking an order

```
keelroom orders place 9074729 SEAWAY --kind arrival --from SEA --to GRAIN-3 \
    --draught 11.20 --at 2025-04-03T06:00
```

The desk checks the ship is on the books, the agent is in a state to order, the
berth exists and takes her length, and the draught is inside her marks. It does
not check the tide: a ship that cannot make the tide still gets a reference,
because the agent needs it to quote in the argument about it.

## Planning

```
keelroom plan show M-2025-0001
keelroom plan confirm M-2025-0001
```

`plan show` prints the windows and the working behind them: which reach asked for
the most water, whether the bridge or the bar is binding, what the standing
orders want in the way of tugs and daylight. `plan confirm` takes the window
nearest the time the agent asked for, or `--at` to take another.

If the answer is no window, the findings say which rule closed it. The commonest
are `WIN-NONE-02` (the tide never reaches what the reach needs) and `AIR-NEVER-01`
(she is too tall for the bridge on any tide).

## Dispatching

```
keelroom dispatch assign M-2025-0001
keelroom tugs book M-2025-0001
keelroom dispatch boarded M-2025-0001 --at 2025-04-03T05:40
keelroom dispatch underway M-2025-0001 --at 2025-04-03T05:55
keelroom dispatch complete M-2025-0001 --at 2025-04-03T08:10
```

The board picks the pilot. A pilot passed over keeps their place and the reason
is recorded, so `keelroom board --warnings` will say when somebody has been
walked over too often. `--pilot` and `--because` override the board and the
override goes in the audit trail.

## Money

```
keelroom billing raise SEAWAY --to 2025-04-30T23:59
keelroom billing issue INV-2025-00001
keelroom billing pay SEAWAY TT-44812 1437500
keelroom billing statement SEAWAY
```

An issued invoice is never edited. Anything that would have changed it becomes a
credit note with a reason code and a ceiling.

## When something changes

A dredger on the bar, a berth out of use, a cable being laid:

```
keelroom notices issue LOWER-BAR dredger working the bar \
    --kind draught-cap --from 2025-04-01T00:00 --to 2025-04-08T00:00 --value 1000
```

Notices bind on the plans made inside their dates. A speed cap slows the ship
through that reach, which moves every later reach along the passage, so it
changes the windows rather than annotating them.

## Keeping the file

```
keelroom district backup /backups/district-$(date +%F).sqlite
keelroom district restore /backups/district-2025-04-01.sqlite
keelroom district compact
```

A restore moves the file it replaces aside rather than overwriting it.

## Reading the numbers

```
keelroom stats return --days 30
keelroom advice dredging --days 30
keelroom tariff simulate 500 --days 90
```

The return is what the board asks for. The dredging study says which reach would
buy the most window if it were deepened, which is not the same as which reach is
shallowest. The tariff simulation reprices what actually ran, by agent, which is
the conversation the agents will start.
