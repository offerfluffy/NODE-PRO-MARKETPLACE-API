SELECT
  id,
  email,
  full_name,
  role
FROM
  users
WHERE
  lower(email) = lower('USER42@EXAMPLE.COM')