alter table public.baladi_game_profiles
add column if not exists bonus_words_found integer not null default 0 check (bonus_words_found >= 0);