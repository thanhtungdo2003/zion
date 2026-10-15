-- Built-in weapons edited in the Studio are stored as overrides: definition only, no model file.
ALTER TABLE custom_weapons ALTER COLUMN model DROP NOT NULL;
