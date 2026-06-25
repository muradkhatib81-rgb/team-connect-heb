
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS on_leave boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS avatar_url text;
