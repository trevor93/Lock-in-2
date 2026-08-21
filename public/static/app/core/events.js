import { esc } from './sanitize.js'

/* ============ EVENT DELEGATION (Book 7) ============
   Inline onclick in generated HTML forces script-src 'unsafe-inline'. Instead one
   delegated listener maps data-act -> a registered handler, invoked as
   (event, el, ...args) with args carried as JSON in data-args. Each module
   registers its own handlers, so no handler needs to be a window.* global. */
export const ACTIONS = {};
export function registerActions(map) { Object.assign(ACTIONS, map); }
export const actArgs = (arr) => esc(JSON.stringify(arr));   // JSON stays valid inside a "double-quoted" attr
function _dispatchAct(e, attr, el) {
  const fn = ACTIONS[el.getAttribute(attr)];
  if (!fn) return;
  let args = [];
  const raw = el.getAttribute('data-args');
  if (raw) { try { args = JSON.parse(raw); } catch (_) { args = []; } }
  fn(e, el, ...args);
}
document.addEventListener('click', (e) => {
  const el = e.target && e.target.closest && e.target.closest('[data-act]');
  if (el) _dispatchAct(e, 'data-act', el);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target && e.target.closest && e.target.closest('[data-act-enter]');
  if (el) _dispatchAct(e, 'data-act-enter', el);
});
document.addEventListener('change', (e) => {
  const el = e.target && e.target.closest && e.target.closest('[data-act-change]');
  if (el) _dispatchAct(e, 'data-act-change', el);
});
