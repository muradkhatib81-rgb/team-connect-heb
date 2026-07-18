-- Bootstrap Storage buckets required by existing storage.objects policies.
-- All six buckets are private: app code uses createSignedUrl, and SELECT
-- policies are granted to authenticated (not anon).

INSERT INTO storage.buckets (id, name, public)
SELECT v.id, v.name, v.public
FROM (
  VALUES
    ('avatars',              'avatars',              false),
    ('task-images',          'task-images',          false),
    ('communications',       'communications',       false),
    ('employee-of-month',    'employee-of-month',    false),
    ('branch-banners',       'branch-banners',       false),
    ('morning-board',        'morning-board',        false)
) AS v(id, name, public)
WHERE NOT EXISTS (
  SELECT 1 FROM storage.buckets b WHERE b.id = v.id
);
