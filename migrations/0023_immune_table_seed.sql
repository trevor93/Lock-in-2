-- Book 10.9 — the naive-versus-master immune table, seeded from what he has ACTUALLY
-- read, exactly as Book 10.9 lists them. Every row carries the six required columns
-- plus the cost of staying naive, so reciting a line always returns both readings.
--
-- Book 10.10 — the edges that make this a cross-book graph rather than a shelf,
-- including the contradiction edges whose note states what selects one principle over
-- its rival.
--
-- Book 10.8 — Greene enters ONLY as hypotheses, flagged UNREAD, defensive-recognition
-- only, and not examinable. The schema enforces that (examinable CHECK = 0).
--
-- Additive: seed rows only.
--
-- ROLLBACK (manual): DELETE the seeded slugs, or drop the tables per 0022's note. No
-- user data is involved: these are curriculum rows, not his records.

-- ---------------------------------------------------------------------------
-- Sun Tzu (from 10.9's own list)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO principles
  (slug, title, source_id, anchor, naive_reading, master_reading, detection_tells,
   inversion_trap, less_obvious_application, stop_test, cost_of_naive)
VALUES
  ('deception_controlled_revelation','Deception is controlled revelation','art_of_war','art_of_war:1:18',
   'Lie freely; keep everyone guessing; be unreadable as a lifestyle.',
   'Control what you reveal and when. Deception is about disclosure timing, not habitual dishonesty — a habitual liar becomes a pattern, and patterns get inverted.',
   'You are keeping a story straight rather than keeping information private; you cannot remember what you told whom.',
   'Lying so routinely that you become predictable, and your predictability is used against you.',
   'Say less, later, rather than saying something false. Silence is the cheapest form of controlled revelation.',
   'Would this still be defensible if the other person read every message I have sent about it?',
   'A reputation as a liar costs more than any single concealment gains, and it is very hard to reverse.'),
  ('subdue_without_fighting','Subduing without fighting is positioning','art_of_war','art_of_war:3:2',
   'Avoid all conflict; passivity is wisdom.',
   'Positioning: position so well that the contest is decided before it starts. That is preparation and placement — positioning, not passivity.',
   'You call avoidance "strategy" but cannot name the position you are building.',
   'Mistaking withdrawal for positioning, and losing ground while calling it patience.',
   'Change who is present, what is known, and what the alternatives are, before the conversation happens.',
   'Can I name the specific position that makes this contest unnecessary?',
   'Passivity dressed as strategy loses the ground quietly, and the loss is only visible later.'),
  ('know_the_enemy_self_audit','Knowing the enemy begins as ruthless self-audit','art_of_war','art_of_war:3:18',
   'Study your opponent until you find their weakness.',
   'Know yourself first and without mercy — your own tells, limits and appetites — because most defeats come from self-ignorance, not from the other side''s brilliance.',
   'You have a detailed theory of them and a flattering one of yourself.',
   'Turning self-audit into self-attack, which is another way of avoiding the audit.',
   'Write what you would exploit if you were opposing you, then close those gaps first.',
   'Have I named my own weakness in this situation as precisely as I named theirs?',
   'An unexamined weakness is the thing that decides the outcome, and it will be found by someone.'),
  ('winning_first','Winning first: preparation IS the battle','art_of_war','art_of_war:4:15',
   'Win by performing brilliantly on the day.',
   'The victorious position is built before the engagement; performance on the day mostly reveals which preparation was done.',
   'You are rehearsing improvisation instead of removing the need for it.',
   'Endless preparation used to postpone the engagement forever.',
   'Decide in advance what you will do at each of the three most likely turns.',
   'What have I already done that makes this outcome likely regardless of my performance today?',
   'Improvised effort feels heroic and produces unreliable results you cannot repeat.'),
  ('formlessness','Formlessness is fixed principles with flexible tactics','art_of_war','art_of_war:6:24',
   'Have no fixed positions; be whatever the moment requires.',
   'Principles stay fixed; tactics adapt. Formlessness is about the shape of your moves, never about the shape of your commitments.',
   'Your stated values change with the room.',
   'Calling inconsistency "adaptability" until nobody can rely on you — including you.',
   'Write the two or three commitments that will not move, then let everything else be negotiable.',
   'Which of my commitments did I just describe as flexible?',
   'A person with flexible principles is easy to move, and everyone eventually notices.'),
  ('speed_and_long_wars','Speed: a good plan now beats a perfect plan never','art_of_war','art_of_war:2:3',
   'Always move fast; hesitation is death.',
   'A good plan executed now beats a perfect plan that never arrives — AND long wars destroy the winner. Speed applies to a decision already prepared, not instead of preparation.',
   'You are moving quickly because deciding is uncomfortable, not because the moment is right.',
   'Haste rebranded as decisiveness, starting contests you cannot afford to prolong.',
   'Set a deadline for the decision rather than for the action.',
   'Am I moving now because it is time, or because waiting feels worse?',
   'Prolonged contests entered hastily exhaust the winner; the cost arrives long after the decision.'),
  ('not_moving_while_hot','Do not move while hot','art_of_war','art_of_war:8:15',
   'Strong feeling means the matter is urgent; act on it.',
   'Anger passes and sent messages do not. Heat is information about you, not instruction about the situation.',
   'You are composing a reply you would not send tomorrow.',
   'Suppressing the feeling entirely and never addressing the thing at all.',
   'Write the message, do not send it, and read it the next morning; send what survives.',
   'Would I still send this in twelve hours?',
   'One sent message written hot can cost a relationship or a position permanently.'),
  ('foreknowledge','Foreknowledge is asking people one step ahead','art_of_war','art_of_war:13:4',
   'Intelligence means spying, manipulation or extraction.',
   'Ask people who are one step ahead of you what they wish they had known. It is legal, ordinary and radically underused.',
   'You are guessing about a thing someone nearby has already lived.',
   'Treating information-gathering as covert, which cuts you off from the ordinary kind that actually works.',
   'Ask the person who did it last year what the second-order cost was.',
   'Who has already done this, and have I actually asked them?',
   'Guessing repeats mistakes that a single honest conversation would have prevented.');

-- ---------------------------------------------------------------------------
-- The Prince (from 10.9's list). Book 10.7 requires the framing table for each.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO principles
  (slug, title, source_id, anchor, naive_reading, master_reading, detection_tells,
   inversion_trap, less_obvious_application, stop_test, cost_of_naive)
VALUES
  ('appearance_is_terrain','Appearance is real terrain','the_prince','the_prince:18:3',
   'Manage perception; image is everything.',
   'How you are perceived is part of the ground you operate on — and there are two audiences: the wide one, and the circle where your word must be unbreakable.',
   'You are managing an impression with the people who should be able to rely on you.',
   'Performing for the inner circle too, which destroys the only place your word is worth anything.',
   'Decide deliberately which facts are public, which are private, and which are owed to the circle regardless.',
   'Am I managing an impression with someone who should be getting the truth?',
   'A circle that learns your word is performance stops being a circle, and you lose the only reliable terrain you had.'),
  ('feared_not_hated','Feared, not hated','the_prince','the_prince:17:1',
   'Make people afraid of you so they comply.',
   'Predictable standards and calm, certain consequences — never touching money, loved ones, or dignity. Fear here means reliability of consequence, not intimidation.',
   'Consequences arrive as outbursts rather than as standards.',
   'Cruelty rebranded as firmness, which produces hatred and therefore risk.',
   'State the standard and the consequence in advance, then apply it without heat.',
   'Would I be comfortable if the consequence I am about to apply were read out loud?',
   'Hatred creates people with a permanent motive to harm you; fear without hatred does not.'),
  ('fox_and_lion','Fox and lion are defensive postures','the_prince','the_prince:18:5',
   'Be cunning and violent as it suits you.',
   'See traps (fox) and be expensive to attack (lion). Both are defensive: they reduce what others can do to you rather than licensing what you do to them.',
   'You are using the fox to set traps rather than to see them.',
   'Becoming the predator you were defending against, and inheriting all of that role''s enemies.',
   'Audit which of your positions is cheap to attack, and raise the cost.',
   'Is this move protecting me, or is it hunting someone?',
   'Predation invites coalition; the fox that hunts is eventually hunted.'),
  ('effectual_truth','Effectual truth refuses to plan on wishes','the_prince','the_prince:15:1',
   'Do whatever works; morality is naive.',
   'Plan on how things actually are rather than how they should be. It is a refusal to plan on wishes — not a licence for cruelty.',
   'You are describing what ought to happen as if it were the plan.',
   'Using "realism" to justify what you already wanted to do.',
   'Write the plan twice: once as you wish it, once as it is. Act on the second.',
   'Am I calling something realism to excuse it?',
   'Plans built on wishes fail at the first contact with the actual world, usually expensively.'),
  ('fortune_and_dikes','Fortune is a river with dikes built in the dry season','the_prince','the_prince:25:2',
   'Luck decides; prepare for nothing.',
   'Fortune floods where no dikes were built. The work happens in the dry season, when nothing is going wrong and nobody is watching.',
   'Your preparation only begins when a crisis has already started.',
   'Building dikes forever and never using the river.',
   'Name one dike to build this week while nothing is wrong.',
   'What am I building now that only matters if something goes wrong later?',
   'Every crisis met without prepared defences costs multiples of what preparation would have.'),
  ('never_rent_the_core','Never rent the core','the_prince','the_prince:12:1',
   'Use the best available tools and services for everything.',
   'Mercenaries win battles and lose states. Apps, models and borrowed discipline become mercenaries the MOMENT they replace the muscle rather than assist it.',
   'You cannot perform the core function without the tool.',
   'Refusing all tools, which is its own inefficiency.',
   'Periodically do the core thing unaided, to check the muscle is still yours.',
   'If this tool disappeared tomorrow, could I still do the thing it does?',
   'A capability you have rented can be withdrawn, repriced, or degraded, and by then the muscle is gone.');

INSERT OR IGNORE INTO principle_frames
  (principle_slug, ruler_state_context, civilian_analogy, analogy_breaks_where,
   long_term_cost, legal_ethical_boundary)
VALUES
  ('appearance_is_terrain',
   'A prince is judged by subjects and rivals who cannot see his private conduct; his reputation IS a political instrument.',
   'Professional reputation: what colleagues and institutions believe about your reliability shapes what you are offered.',
   'A private person has no subjects. In friendship, family and romance there is no "wide audience" to manage — managing perception there IS the betrayal.',
   'Perception managed inside the circle destroys trust permanently, and trust is the slowest thing to rebuild.',
   'Never misrepresent facts to someone entitled to them; never manufacture a record.'),
  ('feared_not_hated',
   'A prince must be obeyed without being conspired against; certainty of consequence is cheaper than affection.',
   'Holding a standard at work or in a shared house: consequences stated in advance and applied calmly.',
   'Fear has no legitimate place in intimacy, friendship or family. There, predictability means safety, not consequence.',
   'Consequences applied with heat, or touching money, loved ones or dignity, produce a permanent enemy.',
   'No coercion, no threats, nothing touching another person''s livelihood, family or dignity.'),
  ('fox_and_lion',
   'A prince faces rivals who will use both fraud and force; he must recognise both and be costly to attack.',
   'Noticing a bad-faith negotiation, and being difficult to exploit because your position is documented and your alternatives are real.',
   'Applied to people who owe you nothing but goodwill, both postures read as hostility and manufacture the conflict they anticipated.',
   'A posture held too long becomes a personality; you end up seeing traps that are not there.',
   'Defence only. Setting traps for others crosses out of this principle entirely.'),
  ('effectual_truth',
   'A prince who plans on how men ought to behave loses his state to one who plans on how they do.',
   'Planning around the actual behaviour of institutions and people rather than their stated policies.',
   'In close relationships, treating the other person as a mechanism to be predicted is itself the failure mode.',
   'Realism practised without values erodes into cynicism, which reads every good act as a move.',
   'Describing reality accurately never licenses harming someone.'),
  ('fortune_and_dikes',
   'A prince builds defences before the flood, because fortune favours whoever prepared during calm.',
   'Savings, sleep, documentation, relationships maintained before you need them.',
   'You cannot "build dikes" against a person you love; preparation there is honesty and repair, not defence.',
   'Preparation can become hoarding, which is its own way of never living.',
   'None: preparation harms no one.'),
  ('never_rent_the_core',
   'Mercenary armies are useless and dangerous: a state whose defence is rented does not control it.',
   'Outsourced skills — writing, judgement, discipline — that atrophy when the tool is removed.',
   'Depending on people you love is not renting; interdependence is not mercenary.',
   'A rented capability can be withdrawn or repriced; by then the muscle has gone.',
   'None, though honesty about what a tool wrote or decided is owed.');

-- ---------------------------------------------------------------------------
-- 10.8 Greene: hypotheses only, UNREAD, defensive recognition, not examinable.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO hypotheses
  (slug, source_id, claim, mechanism, assumptions, possible_application, reversal,
   failure_condition, defensive_signs, proportional_defence, evidence_quality,
   long_term_consequence, read_status)
VALUES
  ('greene_never_outshine_master','greene_48_laws',
   'Displaying superiority over a superior provokes retaliation.',
   'Status threat produces defensive behaviour in the person with power to act on it.',
   'Assumes the superior is insecure and that visibility of competence reads as challenge — neither is universal.',
   'As RECOGNITION only: noticing when someone is punishing competence rather than error.',
   'In a healthy institution, demonstrated competence is rewarded; concealing it costs opportunity.',
   'Applied as advice, it produces chronic self-suppression and invisible work.',
   'Credit reassigned, contributions minimised in front of others, praise followed by cost.',
   'Document contributions factually; keep a private record; raise it once, calmly, with evidence.',
   'Anecdotal and historical illustration only. Not a scientific finding.',
   'Habitual self-concealment becomes indistinguishable from having nothing to show.',
   'UNREAD');

-- ---------------------------------------------------------------------------
-- 10.10 edges, including the contradictions that force the real question.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO graph_edges (from_type, from_id, to_type, to_id, kind, note) VALUES
  ('principle','winning_first','node','preparation','supports',NULL),
  ('principle','speed_and_long_wars','node','timing','supports',NULL),
  ('principle','not_moving_while_hot','node','emotional_regulation','supports',NULL),
  ('principle','foreknowledge','node','information','supports',NULL),
  ('principle','deception_controlled_revelation','node','privacy','supports',NULL),
  ('principle','appearance_is_terrain','node','reputation','supports',NULL),
  ('principle','feared_not_hated','node','boundaries','supports',NULL),
  ('principle','fox_and_lion','node','uncertainty','supports',NULL),
  ('principle','fortune_and_dikes','node','fortune','supports',NULL),
  ('principle','never_rent_the_core','node','dependence','supports',NULL),
  ('principle','subdue_without_fighting','node','terrain','supports',NULL),
  ('principle','formlessness','node','adaptation','supports',NULL),
  ('principle','know_the_enemy_self_audit','node','information','supports',NULL),
  ('principle','effectual_truth','node','evidence','supports',NULL),
  -- concepts anchor to their passages and nodes
  ('concept','sunzi_dao','node','legitimacy','supports',NULL),
  ('concept','sunzi_dao','node','alignment','supports',NULL),
  ('concept','sunzi_tian','node','timing','supports',NULL),
  ('concept','sunzi_di','node','terrain','supports',NULL),
  ('concept','sunzi_jiang','node','leadership','supports',NULL),
  ('concept','sunzi_fa','node','logistics','supports',NULL),
  ('concept','sunzi_fa','node','discipline','supports',NULL),
  ('concept','sunzi_dao','section','art_of_war:1:3','anchors',NULL),
  ('concept','sunzi_ch2_cost_of_delay','section','art_of_war:2:1','anchors',NULL),
  -- the contradiction edges: the note says what selects one over the other
  ('principle','speed_and_long_wars','principle','winning_first','contradicts',
   'Speed says move now; preparation says the position is built beforehand. What selects: whether the contest has already begun. Before commitment, prepare; after commitment, prolongation is the cost.'),
  ('principle','deception_controlled_revelation','principle','appearance_is_terrain','contradicts',
   'Controlled revelation withholds; appearance-as-terrain manages what is shown. What selects: which audience. To the wide audience, disclosure is a choice; inside the circle, the word must be unbreakable.'),
  ('principle','subdue_without_fighting','principle','speed_and_long_wars','contradicts',
   'One avoids the contest, the other moves quickly within it. What selects: whether a position exists that makes the contest unnecessary. If it does, position; if it does not, do not dress delay as strategy.'),
  ('principle','feared_not_hated','principle','never_rent_the_core','related',NULL),
  ('principle','fox_and_lion','principle','effectual_truth','related',NULL),
  ('hypothesis','greene_never_outshine_master','node','reputation','detects',
   'Defensive recognition only (Book 10.8): usable to notice competence being punished, never as advice to conceal work.'),
  ('hypothesis','greene_never_outshine_master','principle','appearance_is_terrain','contradicts',
   'The hypothesis counsels concealment; the principle distinguishes audiences and keeps the circle honest. What selects: the principle, always — the hypothesis is UNREAD and defensive-only.');
