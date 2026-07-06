# keelroom

Pilotage dispatch, transit planning and settlement for a compulsory pilotage
district.

Every deep draught ship entering or leaving the port takes a licensed pilot. The
agent orders one days ahead against an estimated arrival, and somebody then has
to work out whether the ship can physically make the transit on that tide, pick
the pilot whose turn it is without breaking the rest rules, raise the tugs,
follow the job while it runs, and bill it afterwards against a published tariff.

That whole loop is what this runs.

## The chain of decisions

Nothing in this system can be computed on its own, and that is the point of it.

The station's harmonic constituents decide the height of tide at a given minute.
The height plus the charted controlling depth of a reach decides the water
available, and the survey's age decides how much of the charted depth the planner
is willing to believe. The ship's static draught plus squat, heel and swell
decides the water needed, and squat depends on her speed and on how much of the
channel her hull blocks, so the required depth is a function of the plan and not
of the ship. Comparing the two over every reach in order, offset by the time it
takes to steam to each one, decides the transit window. The same height of tide
works the other way under a bridge, so a ship that is deep and tall has a window
bounded from both sides and can have none at all.

The window decides the ordering time, which with the rest rules and the turn
board decides who gets the job. The job's category, the ship's pilotage units and
the time of day decide the tariff. A window that has to be moved decides whether
the delay is chargeable detention or a cancellation, and that decides the money.

## Running it

```
npm install
npm test
npm run build
```

Make a district file from a description and start work:

```
keelroom --database district.sqlite init docs/example-district.json
keelroom --database district.sqlite district reaches
keelroom --database district.sqlite tides table NARROWS --days 2
```

`keelroom --help` prints the ordinary day in the order it happens.

## What is in it

| directory | what it holds |
| --- | --- |
| `src/util` | fixed point arithmetic, the minute clock, intervals, csv, tables |
| `src/domain/tide` | harmonic constituents, node factors, prediction, extremes |
| `src/domain/chart` | reaches with ageing surveys, passages, berths, bridges |
| `src/domain/vessel` | dimensions, pilotage units, squat two ways |
| `src/domain/ukc` | the clearance policy, the assessment, and its inverse |
| `src/domain/window` | the sweep, the daylight, the standing orders, the whole plan |
| `src/domain/roster` | licences, duty and rest, the turn board, the assignment engine |
| `src/domain/movement` | the job, its lifecycle guards, the card and detention |
| `src/domain/tariff` | books by date, bands, surcharges, penalties, the assessment |
| `src/domain/billing` | invoices, credit notes, accounts, the ledger |
| `src/domain/notice` | notices to mariners and what they do to a plan |
| `src/domain/traffic` | who is in which reach, and where ships meet |
| `src/domain/tug` | the towage fleet and its bookings |
| `src/domain/weather` | the observation log |
| `src/domain/boat` | the boarding grounds and the launches |
| `src/domain/berth` | who is lying where, worked out from the movements |
| `src/domain/audit` | the trail of decisions people argue about later |
| `src/domain/statistics` | the numbers the district reports on itself |
| `src/storage/migrations` | the schema, one migration at a time |
| `src/service` | the use cases the cli and the api both call |
| `src/report` | text renderings, including the morning bulletin |
| `src/api` | the read side, on the node standard library |
| `src/cli/commands` | one file per command group |
| `tests` | the whole suite, mirroring `src` |

`src/storage` itself holds the stores and the backup; `src/cli` holds the program
and the wrapper every command action goes through.

## Conventions

- Heights and depths are integer centimetres, money is integer cents, and time is
  integer minutes since the epoch. No record holds a float.
- Every rule that can fire has a stable id, generated into `docs/rules.md`.
- Exit codes: 0 clean, 1 findings, 2 usage, 3 internal.
- Tests live under `tests/`, never beside the source.

## Documents

- `docs/commands.md` every command, generated from the program
- `docs/rules.md` every rule id, generated from the source
- `docs/operations.md` how a district is run day to day
- `docs/example-district.json` a district description to start from
