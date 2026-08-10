# Changelog

The versions this district has run, and what changed in them. Dates are the day
the version was cut.

## 0.1.0 — 2026-08-04

The first version that runs a district end to end.

### Planning

- Harmonic tide prediction from a station's fitted constants, with node factors,
  extremes found by bisecting the rate, and the stretches above or below a
  height as intervals.
- Secondary ports as corrections to a standard one.
- Reaches whose planned depth ages with the survey, passages with per reach
  offsets, bridges bounding the window from above, berths with their own depth.
- Squat two ways with the worse of the two taken where the channel is confined
  or the water shallow; the clearance policy, the assessment and its inverse.
- The sweep: every constraint as a set of start times, intersected. Daylight
  from a computed sunrise, the standing orders for tugs and one way traffic.
- Notices to mariners that bind on the plan, including a speed cap that changes
  the passage rather than annotating it.
- The weather log, and plans made against the forecast for the time she runs.

### Dispatch

- Pilots with licence limits, endorsements and paper dates, duty and rest rules,
  the turn board, and an assignment engine that records why it passed anybody
  over.
- The movement lifecycle with guards, the card, and detention in started blocks.
- Traffic occupancy and conflicts, the towage fleet and its bookings, the launch
  that takes the pilot out.
- The berth diary, worked out from the movements themselves.

### Money

- Tariff books by date, unit bands, surcharges against the base and not each
  other, cancellation and detention charges.
- Invoices that are never edited, credit notes with reason ceilings, agent
  accounts, the ledger with oldest first allocation, deposits and disputes.

### Running it

- A district file built from a json description, migrations, backup and restore.
- The command line, the read side over http, the morning bulletin, the district
  return, the dredging study and the draught advice.
- The audit trail, the generated command, rule and api references.
