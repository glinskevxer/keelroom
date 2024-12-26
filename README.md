# keelroom

Pilotage dispatch, transit planning and settlement for a compulsory pilotage
district.

The port takes a pilot on every deep draught movement. An agent orders one
against an estimated arrival, and before that order can be accepted somebody has
to know whether the ship can actually make the transit on that tide, which pilot
is next on the board and free to take it, and what the job will cost.

## Running it

```
npm install
npm test
npm run build
```

The command line entry point is `keelroom`. Everything it does is against a
local sqlite file; there is no server to stand up.

## Layout

- `src/util` fixed point arithmetic and the small shared pieces
- `src/domain` the rules, with no storage and no io in them
- `src/storage` schema, migrations and repositories
- `src/service` the use cases the cli and the api both call
- `src/cli` argv handling
- `tests` the whole suite, mirroring `src`
