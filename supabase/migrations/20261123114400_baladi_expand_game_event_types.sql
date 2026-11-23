alter table public.baladi_game_events
  drop constraint if exists baladi_game_events_event_type_check;

alter table public.baladi_game_events
  add constraint baladi_game_events_event_type_check
  check (event_type = any (array[
    'level_completed'::text,
    'hint_used'::text,
    'word_found'::text,
    'daily_streak_reward'::text,
    'hint_clue_used'::text
  ]));
