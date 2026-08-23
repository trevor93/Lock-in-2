-- ============ MASTER SCHEDULE (weekday default) ============
INSERT INTO schedule_blocks (sort_order, start_time, end_time, title, category, description, days, is_non_negotiable, points) VALUES
(1,'05:45','06:00','Wake Up + Hydrate + Make Bed','morning','No snooze. Feet on floor in 10s. 500ml water + pinch of salt. Made bed = first win.','mon,tue,wed,thu,fri,sat,sun',1,15),
(2,'06:00','06:15','Morning Skincare + Teeth','skincare','Cleanser -> (toner) -> moisturizer -> SPF (non-negotiable). Brush teeth.','mon,tue,wed,thu,fri,sat,sun',0,10),
(3,'06:15','06:30','Sunlight + Mobility','morning','Sunlight within 30-60 min of waking (Huberman). Light stretching, ideally outside.','mon,tue,wed,thu,fri,sat,sun',0,10),
(4,'06:30','07:15','Home Workout','workout','Mon Push / Tue Legs / Wed Pull+Core / Thu HIIT / Fri Full Body / Sat Walk+Mobility / Sun Rest-stretch only.','mon,tue,wed,thu,fri,sat',1,20),
(5,'07:15','07:30','Shower (end 30-60s cold)','morning','Cold finish = alertness + willpower training.','mon,tue,wed,thu,fri,sat,sun',0,5),
(6,'07:30','07:55','Breakfast + Review Plan','meal','Protein-forward. Eat, do not scroll. Know your 3 targets for today.','mon,tue,wed,thu,fri,sat,sun',0,10),
(7,'07:55','08:00','Transition Ritual','morning','Desk clear. Phone in another room. Enter the arena.','mon,tue,wed,thu,fri',0,5),
(8,'08:00','09:30','DEEP WORK 1 - Projects','deepwork','90-min sprint. Zero interruptions. Phone outside the room.','mon,tue,wed,thu,fri',1,25),
(9,'09:30','09:45','Break - Walk, Water, NO Phone','flex','Ultradian recovery. Move your body.','mon,tue,wed,thu,fri',0,5),
(10,'09:45','11:00','DEEP WORK 2 - Projects','deepwork','75-min sprint. When 11:00 hits you STOP - even mid-flow (Hemingway trick).','mon,tue,wed,thu,fri',1,25),
(11,'11:00','12:30','University Study 1','study','Active recall + Anki, never passive re-reading. Attend class if scheduled - class time overrides this block.','mon,tue,wed,thu,fri',1,20),
(12,'12:30','13:00','Light Study - Review + Plan','study','Review notes, organize, set tomorrow study targets.','mon,tue,wed,thu,fri',0,10),
(13,'13:00','13:30','Lunch','meal','Real food, away from the desk.','mon,tue,wed,thu,fri,sat,sun',0,10),
(14,'13:30','14:00','NSDR / Power Nap (20 min max)','flex','NASA: 26-min naps = +34% performance. Alarm mandatory.','mon,tue,wed,thu,fri',0,10),
(15,'14:00','15:30','STRATEGY MASTERY - Sun Tzu / Machiavelli','strategy','Open the Campaign tab. Read the active unit -> field drill -> flashcards (10 min).','mon,tue,wed,thu,fri,sat',1,25),
(16,'15:30','17:00','University Study 2 / Project Overflow','study','Decided the night before - never in the moment.','mon,tue,wed,thu,fri',0,15),
(17,'17:00','17:30','Admin + Life Maintenance','admin','Emails, errands, laundry, dishes, finances. Chaos room = chaos mind.','mon,tue,wed,thu,fri',0,10),
(18,'17:30','18:00','Walk + Social Connection','social','Decompress outside. Call family or a friend. Isolation destroys disciplined people.','mon,tue,wed,thu,fri,sat,sun',0,10),
(19,'18:00','18:45','Dinner','meal','Last big meal 3+ hours before bed.','mon,tue,wed,thu,fri,sat,sun',0,10),
(20,'18:45','20:15','Entertainment (Earned)','entertainment','Guilt-free BECAUSE it is scheduled. Contained recovery, not decay.','mon,tue,wed,thu,fri,sat,sun',0,5),
(21,'20:15','21:15','Philosophy Reading','philosophy','Stoics, Nietzsche, Plato. Paper or e-ink, warm light. Slow reading is fine - depth beats speed.','mon,tue,wed,thu,fri,sat,sun',1,20),
(22,'21:15','21:30','Night Skincare + Floss','skincare','Cleanser -> treatment -> moisturizer. Floss nightly.','mon,tue,wed,thu,fri,sat,sun',0,10),
(23,'21:30','21:50','NIGHT DEBRIEF (Journal)','review','The single highest-leverage habit. Wins / breaks / tomorrow 3 targets / strategy insight.','mon,tue,wed,thu,fri,sat,sun',1,25),
(24,'21:50','22:15','Wind-down - No Screens','review','Dim lights, stretch, prep tomorrow (clothes, desk, water).','mon,tue,wed,thu,fri,sat,sun',0,10),
(25,'22:15','22:30','In Bed - Lights Out 22:30','sleep','Room cool + dark. Phone NOT in the room. 7h15m minimum.','mon,tue,wed,thu,fri,sat,sun',1,15),
(26,'08:00','09:30','Saturday Deep Work (Half-Day)','deepwork','One deep block only. Then the day is genuinely yours.','sat',0,25),
(27,'10:00','12:00','Saturday Free / Social / Errands','flex','Recovery is training. See people. Touch grass.','sat',0,10),
(28,'09:00','10:00','Sunday Meal Prep + Groceries','admin','Food does not appear by magic. Prep the week.','sun',0,15),
(29,'10:00','11:00','Sunday Weekly Review + Strategy Essay','review','Review week journals, plan next week targets, write the weekly Sun Tzu/Machiavelli application essay. 15-min money review.','sun',1,30),
(30,'11:00','18:00','Sunday Recovery - Free','rest','Genuine rest. Seven identical grind days = burnout by week 3, guaranteed.','sun',0,10);

-- ============ THE 7 LAWS ============
INSERT INTO laws (sort_order, title, detail) VALUES
(1,'When the block ends, you stop.','Even mid-flow. ESPECIALLY mid-flow. This kills the one-project-ate-my-whole-day disease.'),
(2,'Never miss twice.','Miss once = human. Miss twice in a row = the beginning of the end. (Atomic Habits)'),
(3,'Phone lives outside deep work rooms.','Not face-down. Outside. Environment design beats willpower.'),
(4,'The night-before decision rule.','Tomorrow''s 3 targets are written tonight. Never wake up asking what to do.'),
(5,'Track, don''t trust.','The nightly debrief is your intelligence report. (Sun Tzu: know yourself.)'),
(6,'80% adherence = victory.','Perfectionism is procrastination wearing armor. 80% beats 99% of people.'),
(7,'Start with 3 anchors, not 20.','Week 1: fixed sleep/wake + morning deep work + nightly debrief. Add the rest weekly. Gradual systems survive.');

-- ============ REWARDS CATALOG (points economy) ============
INSERT INTO rewards (title, cost, description) VALUES
('Extra 30 min entertainment', 100, 'Extend tonight''s entertainment block guilt-free.'),
('Movie night (full film)', 200, 'Replace philosophy block once with a full movie.'),
('Sleep-in Saturday (+1 hour)', 250, 'Wake at 06:45 Saturday, workout becomes optional walk.'),
('Cheat meal', 300, 'One meal, zero rules.'),
('Full free evening', 500, 'From 17:30, the evening is 100% yours. Debrief still mandatory.'),
('Buy yourself something (~small treat)', 800, 'You earned it in blood. Redeem consciously.');

-- ============ SETTINGS ============
INSERT INTO settings (key, value) VALUES
('start_date', date('now')),
('timezone_offset', '+3'),
('user_name', 'Commander'),
('pace_mode', 'deep'), -- slow reader mode: units have no deadline, only sequence
('grace_minutes', '30'); -- minutes after block end before AUTO-CANCEL + penalty

-- THE TONGUE is now the RESPONSE LAB (Book 12.7). The three starter lines that
-- used to be seeded here are deleted: they were movie-villain lines, the exact
-- register Book 12.6 rejects with "if it reads like a reel, it is rejected", and
-- their source was a book rather than the room. The armory is now built only from
-- his own encounters, one intent at a time, through the Response Lab.
--
-- Databases seeded before this change keep their rows: migration
-- 0027_response_lab_seed.sql ARCHIVES them (archived=1, the application's own
-- delete path) rather than destroying them, because his drill history on those
-- rows is real data and never deleting user data outranks tidiness.
