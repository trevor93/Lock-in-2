// Book 7 core/sanitize — the only place user/model text becomes HTML-safe.
// Dependency-free so it initialises before every module that renders.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const nl2br = (s) => esc(s).replace(/\n/g,'<br>');
