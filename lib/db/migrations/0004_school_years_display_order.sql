ALTER TABLE school_years ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

UPDATE school_years
SET display_order = sub.rn
FROM (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY id DESC) - 1)::int AS rn
  FROM school_years
) sub
WHERE school_years.id = sub.id;
