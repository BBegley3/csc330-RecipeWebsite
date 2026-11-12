// server.js
const express = require('express');
const pool = require('./db');
const path = require('path');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

const { clerkMiddleware, getAuth, clerkClient } = require('@clerk/express');

const isId = (value) =>
  Number.isInteger(value) && value > 0 && value <= 2147483647;

const isText = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const isOptionalText = (value) =>
  value == null || typeof value === 'string';  

function handleDatabaseError(err, res, next) {
  if (err.code === '23503') {
    return res.status(400).json({
      error: 'A referenced user, recipe, section, or tag does not exist'
    });
  }

  if (err.code === '23505') {
    return res.status(409).json({
      error: 'That relationship already exists'
    });
  }

  next(err);
}

// Reused by the recipe feed and saved-recipes list.
// Separate subqueries prevent tags and save counts from multiplying.
const recipeSummary = `
  SELECT
    r.id,
    r.userId AS "userId",
    r.title,
    r.descript,
    r.credits,
    r.img,
    (
      SELECT COUNT(*)::int
      FROM public.saved_recipes sr
      WHERE sr.recipeId = r.id
    ) AS save_count,
    (
      SELECT COALESCE(
        json_agg(t.tag ORDER BY t.tag),
        '[]'::json
      )
      FROM public.recipe_tags rt
      JOIN public.tags t ON t.id = rt.tagId
      WHERE rt.recipeId = r.id
    ) AS tags
  FROM public.recipes r
`;

app.use(express.json());
app.use(clerkMiddleware());

async function loadUser(req, res, next) {
  try {
    req.user = null;

    const { userId: clerkId } = getAuth(req);

    if (!clerkId) {
      return next();
    }

    const clerkUser = await clerkClient.users.getUser(clerkId);

    const email = clerkUser.emailAddresses.find(
      address => address.id === clerkUser.primaryEmailAddressId
    )?.emailAddress ?? null;

    // Register the database user automatically on first authenticated request.
    const result = await pool.query(`
      INSERT INTO public.users (clerk_id, email, userType)
      VALUES ($1, $2, 'User')
      ON CONFLICT (clerk_id)
      DO UPDATE SET email = EXCLUDED.email
      RETURNING id
    `, [clerkId,email]);

    req.user = result.rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Sign in required'
    });
  }

  next();
}

app.use('/api', loadUser);

// ============================================================
// HEALTH CHECK â€” proves the DB connection works.
// Do this BEFORE writing any routes.
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1 AS ok');
    res.json({ status: 'ok', database: result.rows[0].ok === 1 });
} catch (err) {
  console.error('Health check failed:', err);

  res.status(503).json({
    status: 'error',
    database: false
  });
}
});


// ------------------------------------------------------------
// GET /api/recipes?sort_by=save_count&order=DESC&search=cookies&tags=BAKING&tags=COOKING
// List every recipe, this will be used for the main page. Which will be a feed of recipes the user scrolls through
// ------------------------------------------------------------
app.get('/api/recipes', async (req, res, next) => {
  const sortBy = req.query.sort_by === 'createdAt'? 'r.createdAt':'save_count';
  const rawTags = req.query.tags;

  const tags = rawTags === undefined
    ? []
    : Array.isArray(rawTags) ? rawTags : [rawTags];

  if (!tags.every(tag => typeof tag === 'string' && tag.trim() !== '')) {
    return res.status(400).json({
      error: 'tags must contain non-empty strings'
    });
  }

  const searchTags = tags.map(tag => tag.trim().toUpperCase());

  const sortOrder = req.query.order === 'ASC'? 'ASC':'DESC';

  if (
    req.query.search !== undefined &&
    typeof req.query.search !== 'string'
  ) {
    return res.status(400).json({
      error: 'search must be a string'
    });
  }

  const search_text= req.query.search?.trim() ?? ''

  try {
    const result = await pool.query(`
      ${recipeSummary}
      WHERE r.isPrivate = FALSE 
      AND ($1 = '' OR STRPOS(LOWER(r.title), LOWER($1)) > 0)
      AND (
        cardinality($2::text[]) = 0
        OR EXISTS (
          SELECT 1
          FROM public.recipe_tags rt
          JOIN public.tags t ON t.id = rt.tagId
          WHERE rt.recipeId = r.id
            AND t.tag = ANY($2::text[])
        )
      )
      ORDER BY ${sortBy} ${sortOrder}, r.id ${sortOrder}
    `,[search_text,searchTags]);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});


// ------------------------------------------------------------
// GET /api/recipes/:id
// All info about one specific recipe for populating a recipe page. User selects a recipe on recipes page and is taken to a page with this info
// ------------------------------------------------------------
app.get('/api/recipes/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const userId = req.user?.id ?? null;

  if (!isId(id)) {
    return res.status(400).json({
      error: 'Recipe id must be a positive integer'
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.userId AS "userId",
        r.title,
        r.descript,
        r.credits,
        r.isPrivate AS "isPrivate",
        r.img,
        (
          SELECT COUNT(*)::int
          FROM public.saved_recipes sr
          WHERE sr.recipeId = r.id
        ) AS save_count,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object('id', t.id, 'tag', t.tag)
              ORDER BY t.tag, t.id
            ),
            '[]'::json
          )
          FROM public.recipe_tags rt
          JOIN public.tags t ON t.id = rt.tagId
          WHERE rt.recipeId = r.id
        ) AS tags,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', s.id,
                'title', s.title,
                'ingredients', (
                  SELECT COALESCE(
                    json_agg(
                      json_build_object(
                        'id', i.id,
                        'ingredient', i.ingredient,
                        'amount', i.amount,
                        'metric', i.metric
                      )
                      ORDER BY i.id
                    ),
                    '[]'::json
                  )
                  FROM public.ingredients i
                  WHERE i.sectionId = s.id
                ),
                'steps', (
                  SELECT COALESCE(
                    json_agg(
                      json_build_object(
                        'id', st.id,
                        'instruction', st.instruction,
                        'step_number', st.step_number,
                        'img', st.img
                      )
                      ORDER BY st.step_number, st.id
                    ),
                    '[]'::json
                  )
                  FROM public.steps st
                  WHERE st.sectionId = s.id
                )
              )
              ORDER BY s.id
            ),
            '[]'::json
          )
          FROM public.sections s
          WHERE s.recipeId = r.id
        ) AS sections
      FROM public.recipes r
      WHERE r.id = $1
        AND (r.isPrivate = FALSE OR r.userId=$2)
    `, [id,userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Recipe not found'
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});


// ------------------------------------------------------------
// Get /api/saved_recipes?sort_by=save_count&order=DESC&search=cookies&tags=BAKING&tags=COOKING
// ------------------------------------------------------------
app.get('/api/saved-recipes',requireUser, async (req, res, next) => {
  const userId = req.user.id;
  const sortBy = req.query.sort_by === 'createdAt'? 'r.createdAt':'save_count';
  const rawTags = req.query.tags;
  const tags = rawTags === undefined
    ? []
    : Array.isArray(rawTags) ? rawTags : [rawTags];

  if (!tags.every(tag => typeof tag === 'string' && tag.trim() !== '')) {
    return res.status(400).json({
      error: 'tags must contain non-empty strings'
    });
  }

  const searchTags = tags.map(tag => tag.trim().toUpperCase());
  const sortOrder = req.query.order === 'ASC'? 'ASC':'DESC';

  if (
    req.query.search !== undefined &&
    typeof req.query.search !== 'string'
  ) {
    return res.status(400).json({
      error: 'search must be a string'
    });
  }  

  const search_text= req.query.search?.trim() ?? ''

  if (!isId(userId)) {
    return res.status(400).json({
      error: 'user id must be a positive integer'
    });
  }

  try {
    const result = await pool.query(`
      ${recipeSummary}
      WHERE r.isPrivate = FALSE
        AND ($2 = '' OR STRPOS(LOWER(r.title), LOWER($2)) > 0)
        AND (
          cardinality($3::text[]) = 0
          OR EXISTS (
            SELECT 1
            FROM public.recipe_tags rt
            JOIN public.tags t ON t.id = rt.tagId
            WHERE rt.recipeId = r.id
              AND t.tag = ANY($3::text[])
          )
        )
        AND EXISTS (
          SELECT 1
          FROM public.saved_recipes saved
          WHERE saved.recipeId = r.id
            AND saved.userId = $1
        )
      ORDER BY ${sortBy} ${sortOrder}, r.id ${sortOrder}
    `, [userId, search_text, searchTags]);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// -------------------------
// Get /api/my-recipes?sort_by=save_count&order=DESC&search=cookies&tags=BAKING&tags=COOKING
// -------------------------
app.get('/api/my-recipes', requireUser, async (req, res, next) => {
  const sortBy = req.query.sort_by === 'createdAt'? 'r.createdAt':'save_count';
  const sortOrder = req.query.order === 'ASC'? 'ASC':'DESC';

  const rawTags = req.query.tags;
  const tags = rawTags === undefined
    ? []
    : Array.isArray(rawTags) ? rawTags : [rawTags];

  if (!tags.every(tag => typeof tag === 'string' && tag.trim() !== '')) {
    return res.status(400).json({
      error: 'tags must contain non-empty strings'
    });
  }

  const searchTags = tags.map(tag => tag.trim().toUpperCase());

  if (
    req.query.search !== undefined &&
    typeof req.query.search !== 'string'
  ) {
    return res.status(400).json({
      error: 'search must be a string'
    });
  }

  const search_text= req.query.search?.trim() ?? ''

  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.title,
        r.descript,
        r.img,
        r.isPrivate AS "isPrivate",
        (
          SELECT COUNT(*)::int
          FROM public.saved_recipes sr
          WHERE sr.recipeId = r.id
        ) AS save_count,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object('id', t.id, 'tag', t.tag)
              ORDER BY t.tag, t.id
            ),
            '[]'::json
          )
          FROM public.recipe_tags rt
          JOIN public.tags t ON t.id = rt.tagId
          WHERE rt.recipeId = r.id
        ) AS tags
      FROM public.recipes r
      WHERE userId = $1 
      AND ($2 = '' OR STRPOS(LOWER(r.title), LOWER($2)) > 0)
      AND (
        cardinality($3::text[]) = 0
        OR EXISTS (
          SELECT 1
          FROM public.recipe_tags rt
          JOIN public.tags t ON t.id = rt.tagId
          WHERE rt.recipeId = r.id
            AND t.tag = ANY($3::text[])
        )
      )
      ORDER BY ${sortBy} ${sortOrder}, id ${sortOrder}
    `, [req.user.id,search_text,searchTags]);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------
// POST /api/recipes
// Body:
// {
//   title, descript, credits, isPrivate, img, tag_ids,
//   sections: [
//     {
//       title,
//       ingredients: [{ ingredient, amount, metric }],
//       steps: [{ instruction, img }]
//     }
//   ]
// }
// ----------------------------------------------------------------

app.post('/api/recipes', requireUser, async (req, res, next) => {
  const user_id = req.user.id;

  if (
    req.body === null ||
    typeof req.body !== 'object' ||
    Array.isArray(req.body)
  ) {
    return res.status(400).json({
      error: 'Request body must be a JSON object'
    });
  }

  const {
    title='',
    descript='',
    credits='',
    isPrivate = true,
    img,
    tag_ids = [],
    sections = []
  } = req.body ?? {};

  const errors = [];

  if (!isId(user_id)) {
    errors.push('user_id must be a positive integer');
  }

  if (!isOptionalText(title)) {
    errors.push('title must be string or null');
  }

  if (typeof isPrivate !== 'boolean') {
    errors.push('isPrivate must be a boolean');
  }

  if (![descript, credits, img].every(isOptionalText)) {
    errors.push('descript, credits, and img must be strings or null');
  }

  if (!Array.isArray(tag_ids) || !tag_ids.every(isId)) {
    errors.push('tag_ids must be an array of positive integer ids');
  }

  if (!Array.isArray(sections)) {
    errors.push('sections must be an array');
  } else {
    sections.forEach((section, index) => {
      const label = `Section ${index + 1}`;

      if (
        !section ||
        typeof section !== 'object' ||
        Array.isArray(section)
      ) {
        errors.push(`${label} must be an object`);
        return;
      }

      if (!isOptionalText(section.title)) {
        errors.push(`${label}: title must be a string or null`);
      }

      if (
        !Array.isArray(section.ingredients) ||
        !section.ingredients.every((ingredient) =>
          ingredient !== null &&
          typeof ingredient === 'object' &&
          !Array.isArray(ingredient) &&
          isOptionalText(ingredient.ingredient) &&
          isOptionalText(ingredient.amount) &&
          isOptionalText(ingredient.metric)
        )
      ) {
        errors.push(`${label}: ingredients must contain valid ingredient objects`);
      }

      if (
        !Array.isArray(section.steps) ||
        !section.steps.every((step) =>
          step !== null &&
          typeof step === 'object' &&
          !Array.isArray(step) &&
          isOptionalText(step.instruction) &&
          isOptionalText(step.img)
        )
      ) {
        errors.push(`${label}: steps must contain valid step objects`);
      }
    });
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  if (!isPrivate) {
  const complete =
    isText(title) &&
    sections.length > 0 &&
    sections.some(section => section.ingredients.length > 0) &&
    sections.some(section => section.steps.length > 0) &&
    sections.every(section =>
      section.ingredients.every(item => isText(item.ingredient)) &&
      section.steps.every(step => isText(step.instruction))
    );

  if (!complete) {
    return res.status(400).json({
      error: 'Publishing requires a title, ingredients, and instructions'
    });
  }
  }

  let client;

  try {
    // A transaction must use the same database connection throughout.
    client = await pool.connect();
    await client.query('BEGIN');

    const recipeResult = await client.query(`
      INSERT INTO public.recipes (
        userId, title, descript, credits, isPrivate, img
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        userId AS "userId",
        title,
        descript,
        credits,
        isPrivate AS "isPrivate",
        img
    `, [
      user_id,
      title?.trim() ?? '',
      descript ?? null,
      credits ?? null,
      isPrivate,
      img ?? null
    ]);

    const recipe = recipeResult.rows[0];

    // Avoid duplicate tag relationships in the same request.
    for (const tagId of new Set(tag_ids)) {
      await client.query(`
        INSERT INTO public.recipe_tags (tagId, recipeId)
        VALUES ($1, $2)
      `, [tagId, recipe.id]);
    }

    for (const section of sections) {
      const sectionResult = await client.query(`
        INSERT INTO public.sections (recipeId, title)
        VALUES ($1, $2)
        RETURNING id
      `, [recipe.id, section.title ?? '']);

      const sectionId = sectionResult.rows[0].id;

      for (const ingredient of section.ingredients) {
        await client.query(`
          INSERT INTO public.ingredients (
            sectionId, ingredient, amount, metric
          )
          VALUES ($1, $2, $3, $4)
        `, [
          sectionId,
          ingredient.ingredient?.trim() ?? '',
          ingredient.amount ?? null,
          ingredient.metric ?? null
        ]);
      }

      for (const [index, step] of section.steps.entries()) {
        await client.query(`
          INSERT INTO public.steps (
            sectionId, instruction, step_number, img
          )
          VALUES ($1, $2, $3, $4)
        `, [
          sectionId,
          step.instruction?.trim() ?? '',
          index + 1,
          step.img ?? null
        ]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json(recipe);
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
      }
    }

    handleDatabaseError(err, res, next);
  } finally {
    if (client) {
      client.release();
    }
  }
});

// -----------------------------------
// POST /api/saved-recipes
// Body: { recipe_id }
// -----------------------------------

app.post('/api/saved-recipes',requireUser, async (req, res, next) => {
  const user_id = req.user.id;
  const { recipe_id } = req.body ?? {};

  if (!isId(recipe_id)) {
    return res.status(400).json({
      error: 'recipe_id must be a positive integer'
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO public.saved_recipes (userId, recipeId, createdAt)
      SELECT $1, r.id, NOW()
      FROM public.recipes r
      WHERE r.id = $2 AND r.isPrivate = FALSE
      RETURNING
        id,
        userId AS "userId",
        recipeId AS "recipeId",
        createdAt AS "createdAt"
    `, [user_id, recipe_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleDatabaseError(err, res, next);
  }
});

// ---------------------------------
// PUT /api/recipes/:id
// ---------------------------------
app.put('/api/recipes/:id', requireUser, async (req, res, next) => {
  const recipeId = Number(req.params.id);
  const userId = req.user.id;

  if (!isId(recipeId)) {
    return res.status(400).json({
      error: 'Recipe id must be a positive integer'
    });
  }

  const isObject = value =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);

  if (!isObject(req.body)) {
    return res.status(400).json({
      error: 'Send the complete draft as a JSON object'
    });
  }

  const {
    title = '',
    descript = '',
    credits = '',
    img = '',
    isPrivate,
    tag_ids = [],
    sections = []
  } = req.body;

  if (typeof isPrivate !== 'boolean') {
  return res.status(400).json({
    error: 'isPrivate must be true or false'
  });
  }

  // Empty text is allowed. Incorrect data types are not.
  const validSections =
    Array.isArray(sections) &&
    sections.every(section =>
      isObject(section) &&
      isOptionalText(section.title) &&
      Array.isArray(section.ingredients) &&
      section.ingredients.every(ingredient =>
        isObject(ingredient) &&
        isOptionalText(ingredient.ingredient) &&
        isOptionalText(ingredient.amount) &&
        isOptionalText(ingredient.metric)
      ) &&
      Array.isArray(section.steps) &&
      section.steps.every(step =>
        isObject(step) &&
        isOptionalText(step.instruction) &&
        isOptionalText(step.img)
      )
    );

  if (
    ![title, descript, credits, img].every(isOptionalText) ||
    !Array.isArray(tag_ids) ||
    !tag_ids.every(isId) ||
    !validSections
  ) {
    return res.status(400).json({
      error: 'Invalid draft format: check text fields, tag IDs, and section arrays'
    });
  }

  if (isPrivate === false) {
  const complete =
    isText(title) &&
    sections.length > 0 &&
    sections.some(section => section.ingredients.length > 0) &&
    sections.some(section => section.steps.length > 0) &&
    sections.every(section =>
      section.ingredients.every(item => isText(item.ingredient)) &&
      section.steps.every(step => isText(step.instruction))
    );

  if (!complete) {
    return res.status(400).json({
      error: 'Publishing requires a title, ingredients, and instructions'
    });
  }
 }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // This also locks the recipe until the transaction finishes.
    const result = await client.query(`
      UPDATE public.recipes
      SET title = $1,
          descript = $2,
          credits = $3,
          img = $4,
          isPrivate = $5
      WHERE id = $6
        AND userId = $7
      RETURNING id, title, isPrivate AS "isPrivate"
    `, [
      title,
      descript,
      credits,
      img,
      isPrivate,
      recipeId,
      userId
    ]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        error: 'Recipe not found'
      });
    }

    // Replace the draft's contents, not the recipe itself.
    await client.query(`
      DELETE FROM public.recipe_tags
      WHERE recipeId = $1
    `, [recipeId]);

    // Cascades also delete the old ingredients and steps.
    await client.query(`
      DELETE FROM public.sections
      WHERE recipeId = $1
    `, [recipeId]);

    for (const tagId of new Set(tag_ids)) {
      await client.query(`
        INSERT INTO public.recipe_tags (recipeId, tagId)
        VALUES ($1, $2)
      `, [recipeId, tagId]);
    }

    for (const section of sections) {
      const sectionResult = await client.query(`
        INSERT INTO public.sections (recipeId, title)
        VALUES ($1, $2)
        RETURNING id
      `, [recipeId, section.title ?? '']);

      const sectionId = sectionResult.rows[0].id;

      for (const ingredient of section.ingredients) {
        await client.query(`
          INSERT INTO public.ingredients (
            sectionId, ingredient, amount, metric
          )
          VALUES ($1, $2, $3, $4)
        `, [
          sectionId,
          ingredient.ingredient ?? '',
          ingredient.amount ?? '',
          ingredient.metric ?? ''
        ]);
      }

      for (const [index, step] of section.steps.entries()) {
        await client.query(`
          INSERT INTO public.steps (
            sectionId, instruction, step_number, img
          )
          VALUES ($1, $2, $3, $4)
        `, [
          sectionId,
          step.instruction ?? '',
          index + 1,
          step.img ?? ''
        ]);
      }
    }

    await client.query('COMMIT');

    res.json({
      message: isPrivate ? 'Recipe saved privately' : 'Recipe published',
      recipe: result.rows[0]
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
      }
    }

    handleDatabaseError(err, res, next);
  } finally {
    client?.release();
  }
});

// ---------------------------------------------------------
// DELETE /api/recipes/:id
// Delete a recipe if the requester owns it or is an Admin.
// ---------------------------------------------------------
app.delete('/api/recipes/:id', requireUser, async (req, res, next) => {
  const recipeId = Number(req.params.id);

  if (!isId(recipeId)) {
    return res.status(400).json({
      error: 'Recipe id must be a positive integer'
    });
  }

  try {
    const result = await pool.query(`
      DELETE FROM public.recipes r
      WHERE r.id = $1
        AND (
          r.userId = $2
          OR EXISTS (
            SELECT 1
            FROM public.users u
            WHERE u.id = $2
              AND u.userType = 'Admin'
          )
        )
      RETURNING r.id
    `, [recipeId, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Recipe not found or you cannot delete it'
      });
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// DELETE /api/saved-recipes/:recipeId
// Remove a bookmark belonging to the signed-in user.
// The recipe itself is not deleted.
// ----------------------------------------------------
app.delete(
  '/api/saved-recipes/:recipeId',
  requireUser,
  async (req, res, next) => {
    const recipeId = Number(req.params.recipeId);

    if (!isId(recipeId)) {
      return res.status(400).json({
        error: 'Recipe id must be a positive integer'
      });
    }

    try {
      const result = await pool.query(`
        DELETE FROM public.saved_recipes
        WHERE recipeId = $1 AND userId = $2
        RETURNING id
      `, [recipeId, req.user.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Saved recipe not found'
        });
      }

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

// -----------------------------------------------------------
// POST /api/users
// loadUser middleware creates the database user if needed.
// Return the existing/new user. No request body is required.
// -----------------------------------------------------------
app.post('/api/users', requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        email,
        username,
        userType AS "userType"
      FROM public.users
      WHERE id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ----------------------
// GET /api/users/me
// ----------------------
app.get('/api/users/me', requireUser, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        username,
        email,
        userType AS "userType",
        createdAt AS "createdAt"
      FROM public.users
      WHERE id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------
// PUT /api/users/me/username
// Body: { "username": "cookie_master" }
// -----------------------------------------
app.put(
  '/api/users/me/username',
  requireUser,
  async (req, res, next) => {
    const { username } = req.body ?? {};

    if (typeof username !== 'string') {
      return res.status(400).json({
        error: 'username must be a string'
      });
    }

    const newUsername = username.trim();

    if (!/^[A-Za-z0-9_]{3,40}$/.test(newUsername)) {
      return res.status(400).json({
        error: 'Username must contain 3–40 letters, numbers, or underscores'
      });
    }

    try {
      const result = await pool.query(`
        UPDATE public.users
        SET username = $1
        WHERE id = $2
        RETURNING id, username
      `, [newUsername, req.user.id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'That username is already taken'
        });
      }

      next(err);
    }
  }
);

// ------------------------
// DELETE /api/users/me
// Will delete the signed in user when called
// ------------------------
app.delete('/api/users/me', requireUser, async (req, res, next) => {
  try {
    await pool.query(`
      DELETE FROM public.users
      WHERE id = $1
    `, [req.user.id]);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Serve images
app.use(
  '/public',
  express.static(path.join(__dirname, 'public'))
);

// ------------------------------------------------------------
// 404 â€” no route matched any request above this line.
// ------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ------------------------------------------------------------
// Central error handler.
// Express recognizes this as an error handler because it has
// FOUR arguments. The `next` parameter is required even though
// we don't call it.
// ------------------------------------------------------------
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Request body must contain valid JSON'
    });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request body is too large'
    });
  }

  console.error('Unhandled error:', err);

  res.status(500).json({
    error: 'Internal server error'
  });
});


app.listen(PORT, () => {
  console.log(`Recipe API running at http://localhost:${PORT}`);
});