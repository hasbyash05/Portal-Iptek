const express = require('express');
const router = express.Router();
const {
  getActiveElection,
  castVote,
  getMonitoringStats,
  addCandidate,
  updateCandidate,
  deleteCandidate,
  updateElectionStatus,
  getVotersAudit,
  resetElectionVotes
} = require('../controllers/electionController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');

// Seluruh endpoint pemilu memerlukan login akun
router.use(authenticate);

// Pemilih & Monitoring
router.get('/active', getActiveElection);
router.get('/monitoring', getMonitoringStats);
router.get('/:id/monitoring', getMonitoringStats);
router.post('/:id/vote', castVote);
router.post('/vote', castVote);

// Panitia Pemilihan (Pengurus & Admin)
router.post('/:id/candidates', isPengurus, handleUpload('candidate_photo'), addCandidate);
router.put('/candidates/:candidateId', isPengurus, handleUpload('candidate_photo'), updateCandidate);
router.delete('/candidates/:candidateId', isPengurus, deleteCandidate);
router.put('/:id/status', isPengurus, updateElectionStatus);
router.get('/:id/voters', isPengurus, getVotersAudit);
router.post('/:id/reset', isPengurus, resetElectionVotes);

module.exports = router;
