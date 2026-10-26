# Query Optimizations

## q1 — Seller products by period

### Before

```text
                                                                    QUERY PLAN
---------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=6877.98..6879.84 rows=16 width=58) (actual time=5.059..6.276 rows=21 loops=1)
   Buffers: shared hit=234 read=4572
   ->  Gather Merge  (cost=6877.98..6879.84 rows=16 width=58) (actual time=5.058..6.273 rows=21 loops=1)
         Workers Planned: 2
         Workers Launched: 2
         Buffers: shared hit=234 read=4572
         ->  Sort  (cost=5877.95..5877.97 rows=8 width=58) (actual time=3.427..3.428 rows=7 loops=3)
               Sort Key: created_at DESC
               Sort Method: quicksort  Memory: 26kB
               Buffers: shared hit=234 read=4572
               Worker 0:  Sort Method: quicksort  Memory: 25kB
               Worker 1:  Sort Method: quicksort  Memory: 25kB
               ->  Parallel Seq Scan on products  (cost=0.00..5877.83 rows=8 width=58) (actual time=0.831..3.347 rows=7 loops=3)
                     Filter: ((seller_id = 15042) AND (created_at >= (now() - '1 year'::interval)) AND (created_at < (now() + '1 day'::interval)))
                     Rows Removed by Filter: 33326
                     Buffers: shared hit=160 read=4572
 Planning:
   Buffers: shared hit=92
 Planning Time: 0.335 ms
 Execution Time: 6.332 ms
(20 rows)
```

### After

```text
                                                                      QUERY PLAN
-------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=81.64..81.69 rows=20 width=58) (actual time=0.188..0.191 rows=21 loops=1)
   Buffers: shared hit=8 read=21
   ->  Sort  (cost=81.64..81.69 rows=20 width=58) (actual time=0.187..0.188 rows=21 loops=1)
         Sort Key: created_at DESC
         Sort Method: quicksort  Memory: 27kB
         Buffers: shared hit=8 read=21
         ->  Bitmap Heap Scan on products  (cost=4.56..81.21 rows=20 width=58) (actual time=0.040..0.162 rows=21 loops=1)
               Recheck Cond: ((seller_id = 15042) AND (created_at >= (now() - '1 year'::interval)) AND (created_at < (now() + '1 day'::interval)))
               Heap Blocks: exact=21
               Buffers: shared hit=5 read=21
               ->  Bitmap Index Scan on idx_products_seller_created_at  (cost=0.00..4.55 rows=20 width=0) (actual time=0.031..0.031 rows=21 loops=1)
                     Index Cond: ((seller_id = 15042) AND (created_at >= (now() - '1 year'::interval)) AND (created_at < (now() + '1 day'::interval)))
                     Buffers: shared hit=3 read=2
 Planning:
   Buffers: shared hit=139 read=1
 Planning Time: 0.568 ms
 Execution Time: 0.247 ms
(17 rows)
```

### Explanation

`idx_products_seller_created_at` replaced the parallel sequential scan with a bitmap index scan. Execution time fell from 6.332 ms to 0.247 ms (about 26x), while shared buffers fell from 4,806 to 29. A small sort remains because a bitmap heap scan does not preserve index order.

## q2 — Recent pending orders

### Before

```text
                                                      QUERY PLAN
-----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=2538.77..2538.90 rows=50 width=30) (actual time=6.931..6.938 rows=50 loops=1)
   Buffers: shared hit=1128
   ->  Sort  (cost=2538.77..2551.10 rows=4930 width=30) (actual time=6.929..6.932 rows=50 loops=1)
         Sort Key: created_at DESC
         Sort Method: top-N heapsort  Memory: 31kB
         Buffers: shared hit=1128
         ->  Seq Scan on orders  (cost=0.00..2375.00 rows=4930 width=30) (actual time=0.004..6.226 rows=5000 loops=1)
               Filter: (status = 'pending'::text)
               Rows Removed by Filter: 95000
               Buffers: shared hit=1125
 Planning:
   Buffers: shared hit=112
 Planning Time: 0.417 ms
 Execution Time: 6.980 ms
(14 rows)
```

### After

```text
                                                                     QUERY PLAN
----------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.28..46.74 rows=50 width=30) (actual time=0.029..0.092 rows=50 loops=1)
   Buffers: shared hit=50 read=2
   ->  Index Scan using idx_orders_pending_created_at on orders  (cost=0.28..4606.27 rows=4957 width=30) (actual time=0.028..0.087 rows=50 loops=1)
         Buffers: shared hit=50 read=2
 Planning:
   Buffers: shared hit=128 read=1
 Planning Time: 0.499 ms
 Execution Time: 0.115 ms
(8 rows)
```

### Explanation

`idx_orders_pending_created_at` replaced the sequential scan and removed the sort because the partial index contains only pending orders in the required order. Execution time fell from 6.980 ms to 0.115 ms (about 61x), while shared buffers fell from 1,128 to 52.

## q3 — Case-insensitive email lookup

### Before

```text
                                             QUERY PLAN
----------------------------------------------------------------------------------------------------
 Seq Scan on users  (cost=0.00..607.00 rows=100 width=63) (actual time=0.031..5.079 rows=1 loops=1)
   Filter: (lower(email) = 'user42@example.com'::text)
   Rows Removed by Filter: 19999
   Buffers: shared hit=307
 Planning:
   Buffers: shared hit=69
 Planning Time: 0.274 ms
 Execution Time: 5.098 ms
(8 rows)
```

### After

```text
                                                          QUERY PLAN
------------------------------------------------------------------------------------------------------------------------------
 Index Scan using idx_users_email_lower on users  (cost=0.29..8.30 rows=1 width=63) (actual time=0.018..0.018 rows=1 loops=1)
   Index Cond: (lower(email) = 'user42@example.com'::text)
   Buffers: shared hit=1 read=2
 Planning:
   Buffers: shared hit=93 read=1
 Planning Time: 0.435 ms
 Execution Time: 0.041 ms
(7 rows)
```

### Explanation

`idx_users_email_lower` made the `lower(email)` expression an index condition and removed the sequential scan. Execution time fell from 5.098 ms to 0.041 ms (about 124x), while shared buffers fell from 307 to 3.

## q4 — Ukrainian catalog search

### Before

```text
                                                      QUERY PLAN
-----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=5982.22..5982.25 rows=11 width=42) (actual time=12.928..12.932 rows=20 loops=1)
   Buffers: shared hit=262 read=4476
   ->  Sort  (cost=5982.22..5982.25 rows=11 width=42) (actual time=12.927..12.928 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 27kB
         Buffers: shared hit=262 read=4476
         ->  Seq Scan on products  (cost=0.00..5982.03 rows=11 width=42) (actual time=0.053..12.746 rows=1000 loops=1)
               Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
               Rows Removed by Filter: 99000
               Buffers: shared hit=256 read=4476
 Planning:
   Buffers: shared hit=96
 Planning Time: 0.430 ms
 Execution Time: 12.979 ms
(14 rows)
```

### After

```text
                                                                     QUERY PLAN
----------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=69.04..69.06 rows=10 width=42) (actual time=1.714..1.717 rows=20 loops=1)
   Buffers: shared hit=1013
   ->  Sort  (cost=69.04..69.06 rows=10 width=42) (actual time=1.713..1.714 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 27kB
         Buffers: shared hit=1013
         ->  Bitmap Heap Scan on products  (cost=30.10..68.87 rows=10 width=42) (actual time=0.351..1.561 rows=1000 loops=1)
               Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
               Heap Blocks: exact=1000
               Buffers: shared hit=1007
               ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.10 rows=10 width=0) (actual time=0.248..0.249 rows=1000 loops=1)
                     Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                     Buffers: shared hit=7
 Planning:
   Buffers: shared hit=142
 Planning Time: 0.611 ms
 Execution Time: 1.783 ms
(17 rows)
```

### Explanation

`idx_products_search_vector` replaced the catalog sequential scan with a GIN-backed bitmap index scan. Execution time fell from 12.979 ms to 1.783 ms (about 7.3x), while shared buffers fell from 4,738 to 1,013. The rank sort remains because GIN does not store `ts_rank` order.

## Морфологія

- `кросівки`: 1000 збігів
- `кросівок`: 400 збігів

Конфігурація `simple` не виконує український стемінг або лематизацію, тому різні відмінкові форми зберігаються як окремі лексеми.
