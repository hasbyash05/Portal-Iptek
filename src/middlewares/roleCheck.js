const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      status: 'error',
      message: 'Akses ditolak. Endpoint ini khusus untuk role Admin.'
    });
  }
  next();
};

const isPengurus = (req, res, next) => {
  if (!req.user || req.user.role !== 'pengurus') {
    return res.status(403).json({
      status: 'error',
      message: 'Akses ditolak. Endpoint ini khusus untuk role Pengurus.'
    });
  }
  next();
};

const isAnggota = (req, res, next) => {
  if (!req.user || req.user.role !== 'anggota') {
    return res.status(403).json({
      status: 'error',
      message: 'Akses ditolak. Endpoint ini khusus untuk role Anggota.'
    });
  }
  next();
};

module.exports = { isAdmin, isPengurus, isAnggota };

