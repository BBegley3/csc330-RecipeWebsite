-- ============================================================
--  Recipe API Seed
--  Run AFTER schema.sql
-- ============================================================

BEGIN;
--  ^^^^^ Wrap everything in one transaction. If any insert
--        fails, the whole thing rolls back and you get a
--        clean, consistent database not a half-seeded one.

-- ------------------------------------------------------------
-- Start clean, but don't drop the tables.
-- TRUNCATE empties them; RESTART IDENTITY resets the id
-- counters back to 1; CASCADE handles the foreign keys.
-- ------------------------------------------------------------
TRUNCATE public.users, public.saved_recipes, public.recipe_tags, public.tags, public.recipes, public.sections, public.ingredients, public.steps RESTART IDENTITY CASCADE;

-- ------------------------------------------------------------
-- Instructors  (explicit ids so we can reference them below)
-- ------------------------------------------------------------
INSERT INTO tags (tag) VALUES
  ('Baking'),
  ('Cooking'),
  ('Vegan'),
  ('Vegetarian');

-- ------------------------------------------------------------
-- Courses
-- Note the last one has instructor_id = NULL (deliberately unassigned)
-- ------------------------------------------------------------
INSERT INTO users (clerk_id, email, username, userType) VALUES
  ('user_3Lz7o4FyEVrIoSysgIjaKFPr4F6','begley.bryan3@gmail.com', 'Bryan', 'Admin');

-- ------------------------------------------------------------
-- Students
-- ------------------------------------------------------------
INSERT INTO recipes (userId, title, descript,credits,isPrivate,img) VALUES
  (1, 'Cookies', 'Chocolate Chip Cookies', 'Laura Sandford',FALSE,'/public/placeholder.png');

-- ------------------------------------------------------------
-- Enrollments — the junction table
-- Each row is one (student, course) pair with an optional grade.
-- ------------------------------------------------------------
INSERT INTO sections (recipeId, title) VALUES
  (1, '');

INSERT INTO ingredients (sectionId, ingredient, amount, metric) VALUES
  (1,'Salted Butter', '1', 'Cup'),
  (1,'Granulated Sugar', '1', 'Cup'),
  (1,'Light Brown Sugar(Packed)', '1', 'Cup'),
  (1,'Pure Vanilla Extract', '2', 'Teaspoons'),
  (1,'Large Eggs', '2', ''),
  (1,'All-Purpose Flour', '3', 'Cups'),
  (1,'Baking Soda', '1', 'Teaspoon'),
  (1,'Baking Powder', '1/2', 'Teaspoon'),
  (1,'Fine Sea Salt', '1', 'Teaspoon'),
  (1,'Semisweet Chocolate Chips', '2', 'Cups');


INSERT INTO public.steps (sectionId, instruction, step_number, img) VALUES
  (1,'Preheat oven to 375 degrees Fahrenheit (190 degrees Celsius). Line three baking sheets with parchment paper and set aside.', 1, '/public/placeholder.png'),
  (1,'In a medium bowl mix flour, baking soda, baking powder and salt. Set aside.', 2, '/public/placeholder.png'),
  (1,'Cream the butter, light brown sugar and granulated sugar together on medium-high speed for 1 minute.', 3, '/public/placeholder.png'),
  (1,'Add the eggs and vanilla and beat on medium-high speed for an additional 1 minute. The mixture should be light and fluffy.', 4, '/public/placeholder.png'),
  (1,'Add the dry ingredients and beat on medium speed until just incorporated.', 5, '/public/placeholder.png'),
  (1,'Stir in the chocolate chips until evenly distributed throughout the dough.', 6, '/public/placeholder.png'),
  (1,'Roll 2-3 Tablespoons (depending on how large you like your cookies) of dough at a time into balls and place them evenly spaced on your prepared cookie sheets. (Note: with 2 Tablespoon cookie scoop, the cookie dough balls weigh 40-45 grams each).', 7, '/public/placeholder.png'),
  (1,'Bake in preheated oven for approximately 8-10 minutes. Take them out when they are just barely starting to turn brown.', 8, '/public/placeholder.png'),
  (1,'Let them sit on the baking pan for 5 minutes before transferring to cooling rack to continue cooling. ', 9, '/public/placeholder.png');

INSERT INTO public.recipe_tags (tagId,recipeId) VALUES
  (1,1);

INSERT INTO public.saved_recipes(userId,recipeId) VALUES
  (1,1);

-- ------------------------------------------------------------
-- Reset the identity sequences.
--
-- We inserted explicit ids above (1, 2, 3, ...), but the
-- underlying sequences that generate NEW ids are still sitting
-- at 1. Without this reset, the next INSERT without an explicit
-- id would try to reuse id=1 and fail with a duplicate-key error.
--
-- setval(sequence, value) sets the sequence to that value.
-- The next call to nextval() returns value + 1.
-- ------------------------------------------------------------

SELECT setval(pg_get_serial_sequence('public.users', 'id'),
              (SELECT MAX(id) FROM public.users));

SELECT setval(pg_get_serial_sequence('public.tags', 'id'),
              (SELECT MAX(id) FROM public.tags));

SELECT setval(pg_get_serial_sequence('public.recipes', 'id'),
              (SELECT MAX(id) FROM public.recipes));

SELECT setval(pg_get_serial_sequence('public.sections', 'id'),
              (SELECT MAX(id) FROM public.sections));

SELECT setval(pg_get_serial_sequence('public.steps', 'id'),
              (SELECT MAX(id) FROM public.steps));

SELECT setval(pg_get_serial_sequence('public.ingredients', 'id'),
              (SELECT MAX(id) FROM public.ingredients));

SELECT setval(pg_get_serial_sequence('public.recipe_tags', 'id'),
              (SELECT MAX(id) FROM public.recipe_tags));
          
SELECT setval(pg_get_serial_sequence('public.saved_recipes', 'id'),
              (SELECT MAX(id) FROM public.saved_recipes));

COMMIT;
