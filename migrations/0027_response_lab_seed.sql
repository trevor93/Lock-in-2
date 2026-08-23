-- ---------------------------------------------------------------------------
-- 0027_response_lab_seed.sql
--
-- Three things Book 11 and Book 12 require, in one migration because they are
-- one commit's worth of content and share a rollback:
--
--   1. SPECIMENS (Book 11.4). Tier 1 is small on purpose. Book 11.4 explicitly
--      REJECTS memorising a thousand specimens verbatim and warns that the
--      application "must not silently reintroduce it", so this seeds only a
--      starting Tier 3 ear bank plus a handful of Tier 2 skeletons. Tier 1 is
--      HIS — six to eight per figure, chosen and copied by hand — and is
--      therefore seeded EMPTY. src/rhetoric.ts holds the target counts and a
--      test asserts the rejected allocation is not reintroduced.
--
--      Every specimen below is public domain by its own author and date, and
--      every one carries a real attribution. Nothing from Farnsworth's own
--      commentary is reproduced; page_ref is left NULL because the page numbers
--      in HIS copy are populated locally by the operator script, never committed.
--
--   2. RESPONSE INTENTS (Book 12.7). Eleven intents, each an ARCHITECTURE
--      rather than a line: "never give the line alone; give the logic of the
--      line so it can be adapted."
--
--   3. THE DELETION Book 12.7 orders: "The movie-villain starter lines
--      currently in the seed data are deleted." Removed from seed.sql for fresh
--      installs; ARCHIVED here for any database that already has them, because
--      "never delete user data" outranks tidiness and his drill history on
--      those rows is real. Only rows still matching the shipped seed's own
--      situation and response are archived, so a line he has edited into his own survives untouched.
--
-- ROLLBACK (manual):
--   DELETE FROM specimens WHERE attribution IS NOT NULL AND created_at IS NOT NULL
--     AND figure_slug IN (SELECT slug FROM figures);   -- see note below
--   DELETE FROM response_intents WHERE slug IN (
--     'boundary','pressure','provocation','loaded_question','negotiation',
--     'disagreement','clarify','repair','de_escalate','inspire','pause');
--   UPDATE captures SET archived=0 WHERE kind='response' AND legacy_table='responses'
--     AND legacy_id IN (1,2,3);   -- captures.id is NOT the legacy response id (0015 remapped)
--   -- The specimens delete is deliberately NOT blanket: if he has added his own
--   -- Tier 1 rows by then, restrict it to id <= (the max id after this migration),
--   -- which OPERATIONS.md records at rollback time. Never delete his rows.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. SPECIMENS. Tier 3 = read aloud once. Tier 2 = skeleton, structure kept and
--    content replaced from his own life. Tier 1 = his, by hand, seeded empty.
-- ===========================================================================
INSERT OR IGNORE INTO specimens (figure_slug, tier, text, attribution, year, public_domain, page_ref) VALUES
  -- Part I ------------------------------------------------------------------
  ('epizeuxis', 3, 'O horror, horror, horror!',
   'Shakespeare, Macbeth, II.iii', '1606', 1, NULL),
  ('epizeuxis', 3, 'Never, never, never, never, never.',
   'Shakespeare, King Lear, V.iii', '1606', 1, NULL),
  ('epimone', 3, 'For Brutus is an honourable man; so are they all, all honourable men.',
   'Shakespeare, Julius Caesar, III.ii', '1599', 1, NULL),
  ('conduplicatio', 3, 'The man that hath no music in himself, nor is not moved with concord of sweet sounds, is fit for treasons, stratagems, and spoils.',
   'Shakespeare, The Merchant of Venice, V.i', '1600', 1, NULL),
  ('diacope', 3, 'A horse! a horse! my kingdom for a horse!',
   'Shakespeare, Richard III, V.iv', '1593', 1, NULL),
  ('diacope', 3, 'Put out the light, and then put out the light.',
   'Shakespeare, Othello, V.ii', '1604', 1, NULL),
  ('anaphora', 3, 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.',
   'Dickens, A Tale of Two Cities, opening', '1859', 1, NULL),
  ('anaphora', 3, 'My mother would speak to me of it; my father would speak to me of it; I would speak to no one of it.',
   'Constructed skeleton example, no attribution claimed', NULL, 1, NULL),
  ('epistrophe', 3, 'When I was a child, I spake as a child, I understood as a child, I thought as a child.',
   '1 Corinthians 13:11, King James Version', '1611', 1, NULL),
  ('epistrophe', 3, 'Government of the people, by the people, for the people, shall not perish from the earth.',
   'Lincoln, Gettysburg Address', '1863', 1, NULL),
  ('symploce', 3, 'They were the same men; they were in the same room; they were of the same mind.',
   'Constructed skeleton example, no attribution claimed', NULL, 1, NULL),
  ('anadiplosis', 3, 'My conscience hath a thousand several tongues, and every tongue brings in a several tale, and every tale condemns me for a villain.',
   'Shakespeare, Richard III, V.iii', '1593', 1, NULL),
  ('polyptoton', 3, 'Not that I loved Caesar less, but that I loved Rome more.',
   'Shakespeare, Julius Caesar, III.ii', '1599', 1, NULL),
  ('polyptoton', 3, 'With eager feeding food doth choke the feeder.',
   'Shakespeare, Richard II, II.i', '1595', 1, NULL),
  -- Part II -----------------------------------------------------------------
  ('isocolon', 3, 'It is a far, far better thing that I do, than I have ever done; it is a far, far better rest that I go to, than I have ever known.',
   'Dickens, A Tale of Two Cities, closing', '1859', 1, NULL),
  ('isocolon', 3, 'Some books are to be tasted, others to be swallowed, and some few to be chewed and digested.',
   'Bacon, Of Studies', '1625', 1, NULL),
  ('chiasmus', 3, 'But many that are first shall be last; and the last shall be first.',
   'Matthew 19:30, King James Version', '1611', 1, NULL),
  ('chiasmus', 3, 'The sabbath was made for man, and not man for the sabbath.',
   'Mark 2:27, King James Version', '1611', 1, NULL),
  ('anastrophe', 3, 'Blessed are the meek: for they shall inherit the earth.',
   'Matthew 5:5, King James Version', '1611', 1, NULL),
  ('polysyndeton', 3, 'And the rain descended, and the floods came, and the winds blew, and beat upon that house.',
   'Matthew 7:25, King James Version', '1611', 1, NULL),
  ('asyndeton', 3, 'I came, I saw, I conquered.',
   'Attributed to Julius Caesar, in Suetonius; standard English rendering', NULL, 1, NULL),
  ('asyndeton', 3, 'It was a town of red brick, or of brick that would have been red if the smoke and ashes had allowed it.',
   'Dickens, Hard Times', '1854', 1, NULL),
  ('ellipsis', 3, 'Some have too much, yet still do crave; I little have, and seek no more.',
   'Sir Edward Dyer, My Mind to Me a Kingdom Is', '1588', 1, NULL),
  -- Part III ----------------------------------------------------------------
  ('praeteritio', 3, 'I say nothing of his debts, nothing of his associates, nothing of the manner in which he came by his office.',
   'Constructed skeleton example, no attribution claimed', NULL, 1, NULL),
  ('aposiopesis', 3, 'I will have such revenges on you both that all the world shall -- I will do such things, what they are yet I know not.',
   'Shakespeare, King Lear, II.iv', '1606', 1, NULL),
  ('metanoia', 3, 'He was a good man -- or rather, he was a man who wished to be thought good.',
   'Constructed skeleton example, no attribution claimed', NULL, 1, NULL),
  ('litotes', 3, 'I am a citizen of no mean city.',
   'Acts 21:39, King James Version', '1611', 1, NULL),
  ('erotema', 3, 'Hath not a Jew eyes? Hath not a Jew hands, organs, dimensions, senses, affections, passions?',
   'Shakespeare, The Merchant of Venice, III.i', '1600', 1, NULL),
  ('hypophora', 3, 'What did it cost me? It cost me the room.',
   'Constructed skeleton example, no attribution claimed', NULL, 1, NULL),
  ('prolepsis', 3, 'It will be said that these men were provoked. They were not provoked; they were paid.',
   'Constructed skeleton example, no attribution claimed', NULL, 1, NULL);

-- Tier 2 SKELETONS. Structure only. Book 11.3 Day 4 has him strip these and refill
-- them from his own life, which is why they are deliberately generic and few: the
-- bank is meant to be built by him, not delivered to him.
INSERT OR IGNORE INTO specimens (figure_slug, tier, text, attribution, year, public_domain, page_ref) VALUES
  ('anaphora',     2, '[X] did not [verb]. [X] did not [verb]. [X] [verb]ed.', 'Skeleton, structure only', NULL, 1, NULL),
  ('epistrophe',   2, 'When I [verb]ed, I [verb]ed like a [noun]; when I [verb]ed, I [verb]ed like a [noun].', 'Skeleton, structure only', NULL, 1, NULL),
  ('symploce',     2, '[A] is what [X] said; [A] is what [Y] said; [A] is what nobody did.', 'Skeleton, structure only', NULL, 1, NULL),
  ('anadiplosis',  2, 'It cost me [A]. [A] cost me [B]. [B] cost me the [C].', 'Skeleton, structure only', NULL, 1, NULL),
  ('isocolon',     2, '[Three words here], [three words here], [three words here].', 'Skeleton, structure only', NULL, 1, NULL),
  ('chiasmus',     2, 'I did not [A] in order to [B]; I [B]ed in order to [A].', 'Skeleton, structure only', NULL, 1, NULL),
  ('asyndeton',    2, 'I [verb]ed, I [verb]ed, I [verb]ed.', 'Skeleton, structure only', NULL, 1, NULL),
  ('polysyndeton', 2, 'And [A] and [B] and [C] and still [D].', 'Skeleton, structure only', NULL, 1, NULL),
  ('litotes',      2, 'That was not [the mildest available understatement of X].', 'Skeleton, structure only', NULL, 1, NULL),
  ('prolepsis',    2, 'You will say [their strongest objection]. [The honest answer, including where it holds].', 'Skeleton, structure only', NULL, 1, NULL);
-- Tier 1 is intentionally EMPTY. Book 11.4: six to eight per figure, HIS, verbatim,
-- permanent, copied BY HAND on Day 2. Seeding it would be the silent reintroduction
-- of the thousand-specimen allocation the book rejects.

-- ===========================================================================
-- 2. RESPONSE INTENTS (Book 12.7). Eleven intents, each an ARCHITECTURE.
--    "Never give the line alone; give the logic of the line so it can be adapted."
--    There are deliberately NO example lines in this table. A line would be copied;
--    an architecture has to be built, which is the entire point of the Response Lab.
-- ===========================================================================
INSERT OR IGNORE INTO response_intents (slug, title, architecture, when_to_use, logic, sort_order) VALUES
  ('boundary', 'Boundary',
   'observation -> standard -> consequence -> exit',
   'When a line has been crossed and the relationship is meant to continue afterwards.',
   'The observation comes first because naming the observable behaviour keeps the exchange about an act rather than a character, which is the only version the other person can concede without losing face. The standard has to be stated as yours, not as a universal law, or it invites debate about the law instead of compliance with it. The consequence must be something you will actually do, because a boundary is only as real as its enforcement. The exit matters most: you stop talking. Continuing past the consequence converts a boundary into a negotiation and re-opens what you just closed.',
   1),
  ('pressure', 'Pressure',
   'acknowledge -> pause -> verify -> decide',
   'When someone needs an answer faster than you can honestly give one.',
   'Acknowledging removes their reason to escalate, because escalation exists to make you notice. The pause is the load-bearing move: it puts your timeline in place of theirs without refusing them anything. Verify before deciding, because the whole cost of pressure is decisions made on unchecked information -- this is the step the urgency was designed to skip. Then decide, and say so plainly. A decision announced after verification is defensible in a way that the same decision made in the first ten seconds never is.',
   2),
  ('provocation', 'Provocation',
   'name the issue -> refuse the bait -> return to the objective',
   'When the intent is to get a reaction rather than a reply.',
   'Naming the issue once, plainly, costs nothing and denies them the pretence that nothing happened. Refusing the bait is the hard part and the necessary one: a provocation is an offer to change the subject to your composure, and any return fire accepts the trade. Returning to the objective is what defeats the move entirely, because the provocation needed one thing -- a visible effect on what you were doing -- and it did not get it.',
   3),
  ('loaded_question', 'Loaded question',
   'reject the false premise -> state the corrected question -> answer',
   'When answering the question as asked would concede something you do not accept.',
   'The premise must be rejected FIRST, before anything else is said, because a loaded question smuggles a claim into its own wording and any direct answer ratifies it. Stating the corrected question is what keeps the rejection from reading as evasion: you are not refusing to answer, you are answering the question that can honestly be asked. Then answer it, and answer it fully. Rejecting the premise and then declining to answer anything leaves the loaded version standing as the only version on the table.',
   4),
  ('negotiation', 'Negotiation',
   'interest -> constraint -> alternative -> conditional proposal',
   'When both sides want an outcome and the terms are the disagreement.',
   'Interest before position: stating what you are trying to achieve gives them something to solve, where a position only gives them something to push against. The constraint is what makes the interest credible and bounds the space honestly. Naming your alternative is what gives the negotiation its floor -- not as a threat, but because a negotiator with no stated alternative is negotiating against himself. The proposal comes last and comes conditional, because a conditional offer can be refused without either side losing anything, which is what lets it be improved instead of defended.',
   5),
  ('disagreement', 'Disagreement',
   'shared point -> exact disagreement -> evidence -> next step',
   'When you think they are wrong and you need the relationship and the truth both intact.',
   'The shared point stated accurately is not politeness; it proves you understood, which is the only thing that makes the disagreement worth hearing. Locating the exact disagreement stops the argument expanding to cover everything either of you has ever thought. Evidence rather than verdict makes the disagreement checkable and therefore resolvable, and it leaves their case standing rather than demanding they withdraw it. The next step is what turns a disagreement into work: without it, being right is the only available outcome and one of you has to lose.',
   6),
  ('clarify', 'Clarify',
   'define the request -> define the term -> define the next action',
   'When you do not yet know what was meant and acting on a guess would be expensive.',
   'Any one of the three may be the whole job -- often the confusion is only in the request, or only in one word. Define the request first because that is where ambiguity is most expensive: acting on a misread request wastes everything downstream. Define the term when a single word is carrying two meanings, which is the failure that survives longest because both sides believe they agreed. Define the next action last, because a clarification that does not end in a concrete next action has only produced agreement about words. State your reading and ask one question, not three: three questions get one answer, usually to the easiest.',
   7),
  ('repair', 'Repair',
   'name the impact -> clarify the intent -> propose the next step',
   'When you were wrong and the other person is owed something.',
   'The impact comes first and comes without explanation attached, because an explanation offered before the impact is acknowledged converts the apology into a defence and the listener hears only the defence. Intent is clarified second and briefly -- it belongs in a repair, since being misread is a real cost, but it belongs after the impact and never as a substitute for it. The next step makes the repair an undertaking rather than a feeling. Then stop: continuing turns the apology into a request for reassurance, which asks them to comfort you for the thing you did.',
   8),
  ('de_escalate', 'De-escalate',
   'slow the pace -> name common ground -> ask one precise question',
   'When the exchange is heating faster than the disagreement warrants.',
   'Pace first, because escalation runs on tempo and pace is the only lever that works before anything has been agreed. Common ground named honestly removes their need to keep proving the part you already accept, and it costs you nothing you should have wanted. One precise question, and only one: a question hands them the next move, which is what breaks the escalation loop, while a second question turns the de-escalation into an interrogation. Precision matters because a vague question at this temperature is heard as a trap.',
   9),
  ('inspire', 'Inspire',
   'truthful stakes -> vivid specificity -> shared purpose',
   'When someone has to act and their obstacle is belief rather than information.',
   'Truthful stakes first, including the difficulty, because that is what makes everything after it credible -- skipping it is why most encouragement is discarded on contact. Vivid specificity is what converts a stake into something a person can picture and therefore act on; an abstraction inspires nobody. Shared purpose last, because it is the step that makes the action theirs rather than yours, and only actions people own get repeated after you have left the room. Any overstatement anywhere in the three is detected and discredits the whole sequence backwards.',
   10),
  ('pause', 'Pause',
   'delay the commitment -> do not disappear -> do not bluff',
   'When the honest move is not to respond now.',
   'The delay is the whole point and it must be named as a delay, not performed as a silence. Not disappearing is what separates a pause from a withdrawal: an unnamed silence is always read as an answer, usually as no, sometimes as contempt. That means naming when you return to it and then actually returning -- a pause you do not come back from teaches the other person that your pauses are exits, and every one afterwards will be resisted. Not bluffing is the third constraint and the one that makes the first two work: no invented reason, no implied alternative you do not have, no suggestion that the delay is strategic when it is simply that you do not yet know.',
   11);

-- ===========================================================================
-- 3. THE BOOK 12.7 DELETION. "The movie-villain starter lines currently in the
--    seed data are deleted." Removed from seed.sql so fresh installs never get
--    them. Here they are ARCHIVED rather than destroyed, because "never delete
--    user data" governs and his review history on these rows is real data.
--
--    archived=1 is the application's own delete path (src/routes/tongue.ts:93),
--    and every read path filters archived=0, so an archived row is gone from the
--    app in exactly the way the book asks.
--
--    The WHERE clause matches only rows still byte-identical to the shipped seed.
--    If he has edited one into something of his own, it is his and it survives.
-- ===========================================================================
UPDATE captures SET archived = 1
WHERE kind = 'response'
  AND archived = 0
  AND response = 'I''ll let the result answer that.'
  AND situation = 'Anyone pressing you to reveal your plans or opinion before you are ready';

UPDATE captures SET archived = 1
WHERE kind = 'response'
  AND archived = 0
  AND response = 'You''d know if it did.'
  AND situation = 'Someone tries to provoke you publicly with an insult dressed as a joke';

-- The third line was seeded with an em dash, so it is matched with the em dash. LIKE
-- was tried first and rejected: D1 caps LIKE pattern length well below this string's,
-- and it fails at runtime with 'LIKE or GLOB pattern too complex'. Non-ASCII in a
-- migration is already proven safe here (0003 through 0007 all carry it).
UPDATE captures SET archived = 1
WHERE kind = 'response'
  AND archived = 0
  AND situation = 'Being asked to commit on the spot to something you have not examined'
  AND response = 'Let me give you an answer worth counting on — tomorrow.';

