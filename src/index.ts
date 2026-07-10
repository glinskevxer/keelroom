/**
 * The public surface, for anything that embeds the district rather than driving
 * it from the command line.
 *
 * Only the pieces a caller outside this package would need: the domain types
 * and rules, the services that use them, and the storage to open a district
 * file. The internal helpers stay internal.
 */

export { VERSION, NAME } from './version';

export type { Cm, Cents, Bps } from './util/units';
export { formatMetres, formatMoney, parseMetres, parseMoney } from './util/units';
export type { Minute, Offset } from './util/clock';
export { formatInstant, formatLocal, parseInstant, parseLocal } from './util/clock';
export type { Interval } from './util/interval';
export { makeInterval, intersectSets, totalMinutes } from './util/interval';
export type { Finding, Severity } from './util/finding';
export { describeFinding, isClear, sortFindings } from './util/finding';
export {
  EXIT_CLEAN,
  EXIT_FINDINGS,
  EXIT_INTERNAL,
  EXIT_USAGE,
  KeelroomError,
  InputError,
  NotFoundError,
  RuleError,
  TransitionError,
} from './util/errors';

export type { TideStation, HarmonicTerm } from './domain/tide/station';
export { makeStation, springRange, tideForm } from './domain/tide/station';
export { predictHeight, predictSeries } from './domain/tide/predict';
export { findExtremes } from './domain/tide/extremes';
export { intervalsAtOrAbove, intervalsAtOrBelow } from './domain/tide/crossing';

export type { District } from './domain/chart/district';
export { makeDistrict, requireBerth, requireReach } from './domain/chart/district';
export type { Reach, ChannelType } from './domain/chart/reach';
export { makeReach, plannedDepth } from './domain/chart/reach';
export type { Berth } from './domain/chart/berth';
export { makeBerth } from './domain/chart/berth';
export type { Overhead } from './domain/chart/overhead';
export { makeOverhead } from './domain/chart/overhead';
export type { Passage, Leg, Direction } from './domain/chart/passage';
export { buildPassage } from './domain/chart/passage';

export type { Vessel, VesselType } from './domain/vessel/vessel';
export { makeVessel, pilotageUnits, sizeClass } from './domain/vessel/vessel';
export { isValidImo, normaliseImo } from './domain/vessel/imo';
export { computeSquat } from './domain/vessel/squat';

export type { UkcPolicy } from './domain/ukc/policy';
export { STANDARD_POLICY, makePolicy, requiredNetClearance } from './domain/ukc/policy';
export type { ReachAssessment, TransitConditions } from './domain/ukc/assessment';
export { assessReach } from './domain/ukc/assessment';
export { deepestDraughtAt, leastTideFor } from './domain/ukc/solve';

export type { PlanResult, PlanRequest as WindowPlanRequest } from './domain/window/plan';
export { planTransit, bestWindow } from './domain/window/plan';
export type { TransitPlan } from './domain/window/sweep';
export { sweep } from './domain/window/sweep';
export { makePosition, sunTimes } from './domain/window/daylight';
export { STANDING_ORDERS, assessRestrictions } from './domain/window/restriction';

export type { Movement, MovementKind, MovementStatus } from './domain/movement/movement';
export { makeMovement, nextReference } from './domain/movement/movement';
export { apply as applyTransition, canMove } from './domain/movement/lifecycle';
export type { MovementTimes, Delay } from './domain/movement/times';
export { detentionBlocks, makeDelay } from './domain/movement/times';

export type { Pilot, Grade } from './domain/roster/pilot';
export { makePilot } from './domain/roster/pilot';
export type { TurnBoard } from './domain/roster/board';
export { makeBoard, order as boardOrder } from './domain/roster/board';
export { assign as assignFromBoard } from './domain/roster/assign';
export { qualifies } from './domain/roster/qualification';
export { checkJob, STANDARD_REST } from './domain/roster/duty';

export type { TariffBook } from './domain/tariff/book';
export { makeBook, bookAt } from './domain/tariff/book';
export type { Assessment } from './domain/tariff/assess';
export { assessMovement } from './domain/tariff/assess';
export { makeCalendar } from './domain/tariff/calendar';

export type { Invoice } from './domain/billing/invoice';
export { makeInvoice, grossTotal } from './domain/billing/invoice';
export type { Account } from './domain/billing/account';
export { makeAccount, standing } from './domain/billing/account';
export { allocate, ageing, balanceFor } from './domain/billing/ledger';

export type { Db } from './storage/database';
export { openDatabase, closeDatabase } from './storage/database';
export { migrate } from './storage/migrate';
export { loadDistrict, saveDistrict } from './storage/district-store';
export { checkDatabase, summarise } from './storage/backup';

export type { DistrictConfig } from './service/config';
export { defaultConfig, parseConfig } from './service/config';
export type { Context } from './service/context';
export { closeContext, contextFrom, openContext } from './service/context';
export { placeOrder, cancelOrder } from './service/ordering';
export { planMovement, confirmMovement } from './service/planning';
export { assignPilot, boardVessel, completeMovement } from './service/dispatch';
export { priceMovement, raiseInvoice } from './service/settlement';
export { issueInvoice, statementFor, takePayment } from './service/collections';

export type { Notice, NoticeKind } from './domain/notice/notice';
export { makeNotice, currentNotices, draughtCapFor } from './domain/notice/notice';
export type { NoticeEffects } from './domain/notice/apply';
export { noticeEffects } from './domain/notice/apply';

export type { Occupancy, Conflict } from './domain/traffic/occupancy';
export { conflicts, occupancyOf } from './domain/traffic/occupancy';

export type { Tug, TugBooking } from './domain/tug/tug';
export { makeTug, allocateTugs, freeTugs } from './domain/tug/tug';

export type { Observation } from './domain/weather/observation';
export { makeObservation, readingAt, beaufort } from './domain/weather/observation';

export type { BoardingGround, PilotBoat, Trip } from './domain/boat/boarding';
export { makeGround, makeBoat, planBoarding } from './domain/boat/boarding';

export type { Stay, BerthConflict } from './domain/berth/stay';
export { staysFrom, berthConflicts } from './domain/berth/stay';

export type { CargoDeclaration, HazardClass } from './domain/vessel/cargo';
export { makeDeclaration, isDangerous } from './domain/vessel/cargo';

export type { SecondaryPort } from './domain/tide/secondary';
export { makeSecondary, secondaryExtremes, secondaryHeight } from './domain/tide/secondary';

export type { Deposit, DepositDraw } from './domain/billing/deposit';
export { makeDeposit, drawDown, heldFor } from './domain/billing/deposit';

export type { Dispute, DisputeGround } from './domain/billing/dispute';
export { raiseDispute, settle as settleDispute, disputedOn } from './domain/billing/dispute';

export type { Contact, ContactRole } from './domain/billing/contact';
export { makeContact, noticeList } from './domain/billing/contact';

export type { AuditEntry, AuditAction } from './domain/audit/entry';
export { makeEntry as makeAuditEntry, auditActions } from './domain/audit/entry';

export type { PeriodSummary, MovementRecord } from './domain/statistics/summary';
export { summarise as summarisePeriod, punctuality } from './domain/statistics/summary';

export type { DistrictDescription } from './service/setup';
export { createDistrict, parseDescription } from './service/setup';
export type { HealthFinding } from './service/health';
export { checkDistrict } from './service/health';
export { trafficFor, checkAgainstTraffic } from './service/traffic';
export { diaryFor, berthsFor } from './service/berths';
export { offerTugs, bookForMovement as bookTugsFor } from './service/towage';
export { offerBoarding, bookBoarding } from './service/boarding';
export { districtReturn } from './service/statistics';
export { studyDredging } from './service/dredging';
export { adviseAt, deepestForWindow } from './service/advice';
export { certificateFor } from './service/certificate';
export { studyRates, raiseBook } from './service/rates';
export { note as recordAudit, trailOf } from './service/audit';
export { buildExport, exportNames } from './service/exports';
export { importVessels, importOrders, importEtas } from './service/imports';

export { buildRouter } from './api/routes';
export { buildServer, serve } from './api/server';

export { renderOrders } from './report/orders';
export { renderTideTable } from './report/tide';
export { renderPlan } from './report/plan';
export { renderBoard } from './report/board';
export { renderInvoice, renderStatement } from './report/money';
export { renderBulletin } from './report/bulletin';
export { renderNotices } from './report/notices';
export { renderReturn } from './report/statistics';
export { renderCertificate } from './report/plan';
