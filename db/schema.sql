DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.recipes CASCADE;
DROP TABLE IF EXISTS public.saved_recipes CASCADE;
DROP TABLE IF EXISTS public.sections CASCADE;
DROP TABLE IF EXISTS public.ingredients CASCADE;
DROP TABLE IF EXISTS public.steps CASCADE;
DROP TABLE IF EXISTS public.tags CASCADE;
DROP TABLE IF EXISTS public.recipe_tags CASCADE;

CREATE TABLE public.users(
    id SERIAL PRIMARY KEY,
    clerk_id TEXT UNIQUE NOT NULL,
    email TEXT,
    username TEXT NOT NULL UNIQUE
        DEFAULT ('user_' || replace(gen_random_uuid()::text, '-', '')),
    userType TEXT,
    createdAt TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.tags(
    id SERIAL PRIMARY KEY,
    tag TEXT NOT NULL
);

CREATE TABLE public.recipes(
    id SERIAL PRIMARY KEY,
    userId INT NOT NULL,
    title TEXT,
    descript TEXT,
    credits TEXT,
    isPrivate BOOLEAN NOT NULL DEFAULT TRUE,
    img TEXT,
    CONSTRAINT fk_uid FOREIGN KEY (userId) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE public.sections(
    id SERIAL PRIMARY KEY,
    recipeId INT NOT NULL,
    title TEXT,
    CONSTRAINT fk_rid FOREIGN KEY (recipeId) REFERENCES public.recipes(id) ON DELETE CASCADE
);

CREATE TABLE public.ingredients(
    id SERIAL PRIMARY KEY,
    sectionId INT NOT NULL,
    ingredient TEXT,
    amount TEXT,
    metric TEXT,
    CONSTRAINT fk_sid FOREIGN KEY (sectionId) REFERENCES public.sections(id) ON DELETE CASCADE
);

CREATE TABLE public.steps(
    id SERIAL PRIMARY KEY,
    sectionId INT NOT NULL,
    instruction TEXT,
    step_number INT NOT NULL CHECK (step_number>0),
    img TEXT,
    CONSTRAINT fk_step_sid FOREIGN KEY (sectionId) REFERENCES public.sections(id) ON DELETE CASCADE,
    CONSTRAINT uq_section_step_num UNIQUE (sectionId, step_number)
);

CREATE TABLE public.saved_recipes(
    id SERIAL PRIMARY KEY,
    userId INT NOT NULL,
    recipeId INT NOT NULL,
    createdAt TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT sr_fk_uid FOREIGN KEY (userId) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT sr_fk_rid FOREIGN KEY (recipeId) REFERENCES public.recipes(id) ON DELETE CASCADE,
    CONSTRAINT uq_rid_uid UNIQUE (userId, recipeId)
);

CREATE TABLE public.recipe_tags(
    id SERIAL PRIMARY KEY,
    tagId INT NOT NULL,
    recipeId INT NOT NULL,
    CONSTRAINT fk_tag_rid FOREIGN KEY (recipeId) REFERENCES public.recipes(id) ON DELETE CASCADE,
    CONSTRAINT fk_tag_tid FOREIGN KEY (tagId) REFERENCES public.tags(id) ON DELETE CASCADE,
    CONSTRAINT uq_tid_rid UNIQUE (tagId, recipeId)
);