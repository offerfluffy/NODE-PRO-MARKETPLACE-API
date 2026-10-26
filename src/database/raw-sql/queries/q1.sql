SELECT
  id,
  name,
  price,
  status,
  created_at
FROM
  products
WHERE
  seller_id = 15042
  AND created_at >= now () - interval '1 year'
  AND created_at < now () + interval '1 day'
ORDER BY
  created_at DESC
LIMIT
  50