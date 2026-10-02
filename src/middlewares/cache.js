/**
 * In-Memory Server Caching Middleware
 * Mencegah beban database dan server berlebih saat banyak pengguna mengakses sistem secara bersamaan.
 */

const memoryCache = new Map();

/**
 * Middleware untuk caching response GET di memory server
 * @param {number} ttlSeconds - Durasi simpan cache dalam detik (default: 15s)
 * @param {function|null} keyGenerator - Fungsi opsional untuk membuat cache key kustom
 */
function cacheMiddleware(ttlSeconds = 15, keyGenerator = null) {
  return (req, res, next) => {
    // Hanya tangani request GET
    if (req.method !== 'GET') {
      return next();
    }

    const key = keyGenerator
      ? keyGenerator(req)
      : `${req.baseUrl}${req.path}:${JSON.stringify(req.query)}:${req.user ? req.user.id : 'anon'}`;

    const cached = memoryCache.get(key);
    const now = Date.now();

    if (cached && cached.expiry > now) {
      res.setHeader('X-Server-Cache', 'HIT');
      return res.status(cached.status || 200).json(cached.body);
    }

    // Intercept res.json untuk menyimpan payload yang berhasil (status 2xx) ke cache
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        memoryCache.set(key, {
          body,
          status: res.statusCode,
          expiry: now + (ttlSeconds * 1000)
        });
      }
      res.setHeader('X-Server-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

/**
 * Menghapus cache berdasarkan string/regex pattern
 * @param {string|RegExp|null} pattern
 */
function clearServerCache(pattern = null) {
  if (!pattern) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (typeof pattern === 'string' && key.includes(pattern)) {
      memoryCache.delete(key);
    } else if (pattern instanceof RegExp && pattern.test(key)) {
      memoryCache.delete(key);
    }
  }
}

/**
 * Middleware untuk membersihkan cache otomatis saat aksi mutasi (POST, PUT, DELETE) berhasil
 * @param {string|RegExp} pattern
 */
function clearCacheOnSuccess(pattern) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        clearServerCache(pattern);
      }
      return originalJson(body);
    };
    next();
  };
}

// Garbage collector: bersihkan key yang sudah expired secara berkala setiap 60 detik
const gcInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of memoryCache.entries()) {
    if (val.expiry <= now) {
      memoryCache.delete(key);
    }
  }
}, 60000);

if (gcInterval.unref) {
  gcInterval.unref();
}

module.exports = {
  cacheMiddleware,
  clearServerCache,
  clearCacheOnSuccess
};
