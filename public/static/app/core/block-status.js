/* Book 8.3 — the block-status taxonomy, client side.
   This is the mirror of src/block-status.ts. It exists because the interface has to
   decide two things the server already knows: which spelling a button WRITES, and
   whether a row that came back already counts as landed. While those decisions were
   three inline literals ('done' / 'partial' / 'skipped'), the client could only write
   the legacy synonyms — so the seven doctrinal states the API has accepted since
   Book 8.3 were unreachable from the only interface the commander has.

   A mirror can drift, so it is not trusted on its word: test/block-status-mirror.test.ts
   reads src/block-status.ts and this file and fails if either set changes without the
   other. That is the same rule the SQL call sites follow — derive the list, then assert
   it, rather than hand-listing it twice and hoping. */

/** Statuses that mean the work landed. `completed` is the spelling the doctrine
    names first; `done` is the legacy synonym kept so no historical row changes. */
export const LANDED = ['completed', 'completed_late', 'done'];
/** Half credit. */
export const PARTIAL = ['partial'];
/** He cancelled it himself and said so — the honest path, priced below an
    unlogged window (Book 17's matrix). 'skipped' is the legacy synonym. */
export const HONESTLY_CANCELED = ['intentionally_canceled', 'skipped'];
/** No moral weight at all: not owed on this day. */
export const EXCLUDED = ['rescheduled', 'displaced_by_priority'];

export const hasLanded = (st) => LANDED.includes(st);
export const isPartial = (st) => PARTIAL.includes(st);
export const isHonestlyCanceled = (st) => HONESTLY_CANCELED.includes(st);
export const isExcusedFromScoring = (st) => EXCLUDED.includes(st);

/* The window passed with no status. Book 8.3: a DATA state carrying a prompt, not a
   verdict — which is why the interface answers it with the cause panel rather than
   with a penalty notice. */
export const isUnreported = (st) => st === 'unreported';

/* The three buttons, in the doctrine's own spellings. `active` asks the predicate,
   not an equality test, so a legacy `done` row still lights the COMPLETED
   button instead of reading as an untouched block. */
export const STATUS_BUTTONS = [
  { value: 'completed', icon: 'fa-check', cls: 'bg-emerald-700 text-white', label: 'COMPLETED', is: hasLanded },
  { value: 'partial', icon: 'fa-star-half-stroke', cls: 'bg-amber-600 text-white', label: 'PARTIAL', is: isPartial },
  { value: 'intentionally_canceled', icon: 'fa-xmark', cls: 'bg-red-800 text-white', label: 'CANCELLED', is: isHonestlyCanceled },
];
/* He did not do it, and he said so himself. This is NOT the same as a window that
   closed unlogged: Book 8.3 removed the auto-cancellation, so nothing but the
   commander's own hand writes `missed`. It exists as a predicate rather than as an
   inline `=== 'missed'` because four such literals in the renderer are how the
   FULL DAY PLAN came to draw a `completed` block as untouched. */
export const isMissed = (st) => st === 'missed';
