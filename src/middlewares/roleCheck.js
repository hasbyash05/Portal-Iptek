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

const isOperasional = (req, res, next) => {
  const isEligible = req.user.role === 'admin' || (req.user.role === 'pengurus' && req.user.divisi && req.user.divisi.toLowerCase().includes('operasional'));
  if (!isEligible) {
    return res.status(403).json({
      status: 'error',
      message: 'Akses ditolak. Endpoint ini khusus untuk divisi Operasional / Admin.'
    });
  }
  next();
};

const isKetuaWakil = (req, res, next) => {
  const isEligible = req.user.role === 'admin' || (req.user.role === 'pengurus' && req.user.divisi && (req.user.divisi.toLowerCase().includes('ketua') || req.user.divisi.toLowerCase().includes('wakil')));
  if (!isEligible) {
    return res.status(403).json({
      status: 'error',
      message: 'Akses ditolak. Endpoint ini khusus untuk Ketua, Wakil Ketua / Admin.'
    });
  }
  next();
};

const isBendahara = (req, res, next) => {
  const isEligible = req.user.role === 'admin' || (req.user.role === 'pengurus' && req.user.divisi && req.user.divisi.toLowerCase().includes('bendahara'));
  if (!isEligible) {
    return res.status(403).json({
      status: 'error',
      message: 'Akses ditolak. Endpoint ini khusus untuk Bendahara / Admin.'
    });
  }
  next();
};

module.exports = { isAdmin, isPengurus, isAnggota, isOperasional, isKetuaWakil, isBendahara };

