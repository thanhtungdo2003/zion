-- The spawn compound is everyone's starting point: positions saved before it existed are dropped
-- once, so every player re-enters the world at the camp. Positions saved afterwards persist.
DELETE FROM player_states;
