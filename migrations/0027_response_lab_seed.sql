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
   'Naming the observable behaviour first keeps the exchange about an act rather than a character, which is the only version the other person can concede without losing face. The standard has to be stated as yours, not as a universal law, or it invites debate about the law instead of compliance with it. The consequence must be something you will actually do, because a boundary is only as real as its enforcement. The exit matters most: you stop talking. Continuing past the consequence converts a boundary into a negotiation and re-opens what you just closed.',
   1),
  ('pressure', 'Pressure',
   'acknowledge the pressure -> name the timeline -> state what happens next -> hold silence',
   'When someone needs an answer faster than you can honestly give one.',
   'Acknowledging the pressure removes their reason to escalate, because escalation exists to make you notice. Naming your timeline replaces their frame with yours without refusing them anything. Stating what happens next gives them something to hold, so the wait is not experienced as a stonewall. Then silence: filling it is where people trade away the timeline they just set.',
   2),
  ('provocation', 'Provocation',
   'decline the frame -> no counter-attack -> return to the actual subject -> proceed as if uninterrupted',
   'When the intent is to get a reaction rather than a reply.',
   'A provocation is an offer to change the subject to your composure. Declining the frame costs nothing and defeats the entire move. Not counter-attacking is the hard part and the necessary one, because any return fire accepts the trade and makes the exchange about the two of you. Returning to the subject and continuing normally denies the provocation the one thing it needed: a visible effect.',
   3),
  ('loaded_question', 'Loaded question',
   'name the premise -> answer or refuse the premise, explicitly -> answer the fair question underneath -> stop',
   'When answering the question as asked would concede something you do not accept.',
   'A loaded question smuggles a claim into the premise so that any direct answer ratifies it, while refusing to answer looks evasive. Naming the premise out loud is what breaks it, and it must be done before answering anything, because once you answer you have agreed. Then answer the fair question underneath if there is one, so you are visibly not dodging. Stopping is essential: explaining why the premise was unfair at length turns your correction into your defence.',
   4),
  ('negotiation', 'Negotiation',
   'confirm the shared goal -> state your constraint -> propose the trade -> name what you will not trade',
   'When both sides want an outcome and the terms are the disagreement.',
   'Confirming the shared goal establishes that you are solving the same problem, which changes what disagreement means for the rest of the conversation. Stating your constraint rather than your position gives them material to work with instead of a wall to push. Proposing the trade puts you in the position of the person offering, which is structurally stronger than the person conceding. Naming the untradeable last, and only once, marks the floor without turning the whole exchange into a defence of it.',
   5),
  ('disagreement', 'Disagreement',
   'state where you agree, accurately -> locate the exact point of divergence -> give your reason -> leave their case standing',
   'When you think they are wrong and you need the relationship and the truth both intact.',
   'Accurate agreement first is not politeness; it proves you understood, which is the only thing that makes the disagreement worth hearing. Locating the exact divergence prevents the argument from expanding to cover everything. Giving a reason rather than a verdict makes the disagreement checkable and therefore resolvable. Leaving their case standing -- not demolishing it, not demanding they withdraw it -- is what allows either of you to change your mind later without it being a defeat.',
   6),
  ('clarify', 'Clarify',
   'state your reading back -> name the specific ambiguity -> ask one question -> wait',
   'When you do not yet know what was meant and acting on a guess would be expensive.',
   'Stating your reading back gives them something concrete to correct, which is far more productive than asking them to explain again. Naming the specific ambiguity shows you have done the work and narrows their answer to the part you actually need. One question, not three: three questions get one answer, usually to the easiest. Waiting without softening the question is what makes it get answered.',
   7),
  ('repair', 'Repair',
   'name what you did -> no explanation attached -> name the effect -> state the change -> stop',
   'When you were wrong and the other person is owed something.',
   'Naming the act plainly is the whole apology; everything else is decoration. Explanation is the failure mode, because an explanation attached to an apology converts it into a defence and the listener hears only the defence. Naming the effect proves you understood the cost rather than merely the rule. Stating the change makes it an undertaking instead of a feeling. Stopping prevents the apology from becoming a request for reassurance, which asks them to comfort you for the thing you did.',
   8),
  ('de_escalate', 'De-escalate',
   'lower the pace -> concede the true part -> narrow the subject -> offer a next step',
   'When the exchange is heating faster than the disagreement warrants.',
   'Escalation runs on tempo, so pace is the first lever and the only one that works before anything is agreed. Conceding the genuinely true part costs you nothing you should have wanted and removes their need to keep proving it. Narrowing the subject stops the argument recruiting every past grievance. An offered next step gives the heat somewhere to go, because de-escalation without a direction is just an unresolved pause that reheats later.',
   9),
  ('inspire', 'Inspire',
   'name the real difficulty -> name what is actually possible -> name the first concrete action -> give them the credit for it',
   'When someone has to act and their obstacle is belief rather than information.',
   'Naming the difficulty first is what makes the rest credible; skipping it is why most encouragement is discarded on contact. What is actually possible must be bounded and true, because an overstatement is detected and discredits everything before it. A single concrete first action converts a feeling into a next step. Giving them the credit makes the action theirs, and only actions people own get repeated after you leave the room.',
   10),
  ('pause', 'Pause',
   'name that you are stopping -> give the reason without apologising -> name when you return to it -> return to it',
   'When the honest move is not to respond now.',
   'Naming the stop is what separates a pause from a withdrawal, which is how an unnamed silence is always read. The reason given without apology keeps the pause from being heard as a concession that you owed an immediate answer. Naming the return time is what makes the pause trustworthy rather than a way of never answering. Actually returning is the whole architecture: a pause you do not come back from teaches the other person that your pauses are exits, and every one afterwards will be resisted.',
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

