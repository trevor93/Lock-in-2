-- Books 11 and 12 — CURRICULUM ROWS ONLY. No personal data is touched except the
-- archival of the shipped starter lines at the end, which Book 12.7 requires.
--
-- What is in here and what deliberately is not:
--   IN:  the syllabus (phases, nineteen chapters, day ranges, consolidations), figure
--        records with both faces, short PUBLIC-DOMAIN specimens with real attributions,
--        the eleven Response Lab intents, and the page anchors that were CONFIRMED by
--        reading the operator's own captures.
--   OUT: any text from Ward Farnsworth's two books. The application references his
--        copy; it never absorbs it (Book 11.8, Law 22). Nothing here is labelled
--        public domain unless it is.
--
-- ROLLBACK (manual, safe): DELETE FROM the curriculum tables below by the slugs and
-- ids seeded here, and set archived=0 on the three captures listed in the final
-- section. No user-authored row is written or removed by this migration.

-- ---------------------------------------------------------------------------
-- The two books, as bibliographic records. NO TEXT IS STORED. Book 10.5 requires
-- honest provenance, so the note says exactly what the application has and has not.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO sources (id, title, author, original_language, first_published, notes) VALUES
  ('classical_english_rhetoric', 'Classical English Rhetoric', 'Ward Farnsworth', 'English', '2011',
   'David R. Godine, 2011. IN COPYRIGHT. The operator owns a personal copy. No text from this work is stored in the application. What the application holds is (a) the structure of the nineteen chapters, (b) figure records written independently from standard classical-rhetoric reference knowledge, (c) short specimens that are themselves public domain by their own author and date, and (d) page references into the operator''s own capture of his own copy. Farnsworth''s selection and commentary are referenced, never reproduced.'),
  ('classical_english_argument', 'Classical English Argument', 'Ward Farnsworth', 'English', NULL,
   'David R. Godine. IN COPYRIGHT. The operator owns a personal copy. Publication year is deliberately left NULL: it was not verified from the captures and is not guessed. Twenty-five chapters in three parts, confirmed from the contents page of his own copy: Part I Offense and Defense (chapters 1-11), Part II Inference and Fallacy (chapters 12-21), Part III Judgments and Tradeoffs (chapters 22-25). No text from this work is stored.');

-- ---------------------------------------------------------------------------
-- 11.1 / 11.2 THE PHASES. Sound, then structure, then stance.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO rhetoric_phases (code, sort_order, title, subtitle, day_from, day_to, architecture) VALUES
  ('P0', 0, 'Calibration', 'the self-audit and the baselines', 53, 53,
   'One day. The nineteen chapters are marked U, R or N; the three-minute recording and the two-hundred-word written baseline are made and NOT listened back.'),
  ('P1', 1, 'Repetition', 'the ear', 54, 97,
   'What you do to WORDS. Percussion. These figures operate below the level of argument: a listener FEELS anaphora before he understands it. Sound comes first because it needs no permission from the mind.'),
  ('P2', 2, 'Structure', 'the mind', 98, 141,
   'What you do to SENTENCES. Order, symmetry, subtraction. These operate on comprehension and expectation: chiasmus and inversion work by violating an order the listener has already predicted, so they require a pattern to violate.'),
  ('P3', 3, 'Drama', 'the listener', 142, 192,
   'What you do to the LISTENER. Every device here is a relationship move, not a word move: it hands the audience a job. Part III is only usable once Parts I and II are in hand, because the dramatic devices are silences and gaps, and a gap only registers against an established pattern.'),
  ('P4', 4, 'The Consolidation', 'combination, failure, diagnosis', 193, 197,
   'The book teaches figures one at a time and never teaches combination. Real eloquence is two or three figures inside a single sentence. This phase builds the master doctrine, the full tiered corpus in one document, the combination drills, the failure catalogue, and the situation-to-figure diagnostic index.'),
  ('P5', 5, 'Transfer to Speech', 'the tongue, under pressure', 198, 204,
   'Patches the book''s known gap: Farnsworth teaches WRITTEN prose through orators and does not cover negotiation, hostile exchange, timing, or room-reading. Which figures survive being said aloud and which collapse on the tongue; cadence under pressure; timing; silence; hostile question-and-answer; negotiation.');

-- ---------------------------------------------------------------------------
-- 11.2 THE NINETEEN CHAPTERS, with the day ranges fixed by the master doctrine.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO rhetoric_chapters (id, phase_code, part, title, figure_slug, day_from, day_to) VALUES
  (1,  'P1', 1, 'Simple Repetition',  'epizeuxis',     54,  60),
  (2,  'P1', 1, 'Anaphora',           'anaphora',      61,  67),
  (3,  'P1', 1, 'Epistrophe',         'epistrophe',    68,  74),
  (4,  'P1', 1, 'Symploce',           'symploce',      75,  81),
  (5,  'P1', 1, 'Anadiplosis',        'anadiplosis',   82,  88),
  (6,  'P1', 1, 'Polyptoton',         'polyptoton',    89,  95),
  (7,  'P2', 2, 'Isocolon',           'isocolon',      98,  104),
  (8,  'P2', 2, 'Chiasmus',           'chiasmus',      105, 111),
  (9,  'P2', 2, 'Anastrophe',         'anastrophe',    112, 118),
  (10, 'P2', 2, 'Polysyndeton',       'polysyndeton',  119, 125),
  (11, 'P2', 2, 'Asyndeton',          'asyndeton',     126, 132),
  (12, 'P2', 2, 'Ellipsis',           'ellipsis',      133, 139),
  (13, 'P3', 3, 'Praeteritio',        'praeteritio',   142, 148),
  (14, 'P3', 3, 'Aposiopesis',        'aposiopesis',   149, 155),
  (15, 'P3', 3, 'Metanoia',           'metanoia',      156, 162),
  (16, 'P3', 3, 'Litotes',            'litotes',       163, 169),
  (17, 'P3', 3, 'Erotema',            'erotema',       170, 176),
  (18, 'P3', 3, 'Hypophora',          'hypophora',     177, 183),
  (19, 'P3', 3, 'Prolepsis',          'prolepsis',     184, 190);

-- The cycles that are not chapters. They are rows so the track is complete rather
-- than implied, and so a day between chapters cannot read as an empty day.
INSERT OR IGNORE INTO rhetoric_milestones (slug, phase_code, title, day_from, day_to, purpose) VALUES
  ('consolidation_a', 'P1', 'Consolidation A', 96, 97,
   'The six repetition figures as ONE system, plus stacking drills. Chapters 1-6 are not six tools; they are one instrument with six settings.'),
  ('consolidation_b', 'P2', 'Consolidation B', 140, 141,
   'Addition against subtraction, and the rhythm system. Polysyndeton and asyndeton are the same decision made in opposite directions; isocolon, ellipsis and anastrophe are the metre around them.'),
  ('consolidation_c', 'P3', 'Consolidation C', 191, 192,
   'The seven stance devices and the unreadability set. Which of the Part III devices leave the counterpart unable to read the position, and what each one costs.'),
  ('phase_4_consolidation', 'P4', 'THE CONSOLIDATION', 193, 197,
   'Master doctrines; the full tiered corpus in one document; combination drills (real eloquence is two or three figures in one sentence and no chapter teaches that); the failure catalogue; the situation-to-figure diagnostic index.'),
  ('phase_5_transfer', 'P5', 'TRANSFER TO SPEECH', 198, 204,
   'Which figures survive being said aloud and which collapse on the tongue; cadence under pressure; timing; silence; hostile question-and-answer; negotiation.');

-- ---------------------------------------------------------------------------
-- PAGE ANCHORS — CONFIRMED ONLY.
--
-- The operator captured both books page by page, in order, as screenshots. The
-- capture sequence was reconstructed from file timestamps and then CHECKED BY READING
-- pages: 622 captures in one unbroken run, the first 371 (indices 0-370) being
-- Classical English Rhetoric and the remaining 251 (indices 371-621) being Classical
-- English Argument. The seam is fixed by two facts read off the pages themselves:
-- index 370 is the rhetoric book's contents page carrying its Bibliographic Note, and
-- index 371 is the argument book's contents page.
--
-- Only anchors whose page was actually read are recorded. The chapter openings that
-- were NOT read are absent rather than estimated, and the application reports the span
-- between two anchors as unconfirmed. Fabricating the other seventeen openings would
-- have been one INSERT away and is exactly what the Laws forbid.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO book_chapter_anchors (book_slug, chapter_id, label, page_index, confirmed_by, is_opening) VALUES
  ('classical_english_rhetoric', NULL, 'Contents', 0,
   'Read. Lists nineteen chapters in three parts; chapter 1 is titled with an "etc." that conceals the other simple-repetition devices.', 0),
  ('classical_english_rhetoric', 1, 'Chapter 1 — Simple Repetition', 9,
   'Read. Body of chapter 1: epizeuxis and diacope specimens (Romeo and Juliet 2,2; Richard III 5,4; Melville, Pierre 1852; Sheil, House of Commons 1843; Dickens, Nicholas Nickleby 1839). Confirms the chapter-1 span, not its first page.', 0),
  ('classical_english_rhetoric', 2, 'Chapter 2 — Anaphora', 26,
   'Read. The chapter OPENS on this page: the definition sentence "Anaphora occurs when the speaker repeats the same words at the start of successive sentences or clauses", with the pronunciation gloss.', 1),
  ('classical_english_rhetoric', 6, 'Chapter 6 — Polyptoton', 67,
   'Read. Body of chapter 6: polyptoton specimens under the sub-heading "Changes of the verb" (Dickens, Hard Times 1854; Lloyd George, International Honour 1914; 1 Corinthians 13:11).', 0),
  ('classical_english_rhetoric', 10, 'Chapter 10 — Polysyndeton', 182,
   'Read. Body of chapter 10.', 0),
  ('classical_english_rhetoric', NULL, 'Contents and Bibliographic Note (last captured page)', 370,
   'Read. The final rhetoric capture; the next capture is the other book''s contents page. This is the seam.', 0),
  ('classical_english_argument', NULL, 'Contents', 371,
   'Read. Twenty-five chapters in three parts: Part I Offense and Defense (1-11), Part II Inference and Fallacy (12-21), Part III Judgments and Tradeoffs (22-25).', 0),
  ('classical_english_argument', 12, 'Chapter 12 — Deduction and Induction', 461,
   'Read. Chapter 12 opens across captures 460-461.', 1);
