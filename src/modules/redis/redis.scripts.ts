export const UNLOCK_LUA = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end

  return 0
`;

export const SLIDING_WINDOW_LUA = `
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])

  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)

  local count = redis.call('ZCARD', KEYS[1])

  if count >= limit then
    return 0
  end

  redis.call('ZADD', KEYS[1], now, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], window)

  return 1
`;
