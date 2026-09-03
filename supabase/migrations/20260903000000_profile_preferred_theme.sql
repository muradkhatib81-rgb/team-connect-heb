-- Add preferred_theme column to profiles table
alter table public.profiles
  add column if not exists preferred_theme text check (preferred_theme in ('light', 'dark', 'system')) default 'system';
