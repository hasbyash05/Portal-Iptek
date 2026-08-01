const express = require('express');
const router = express.Router();
const { addExpense, getExpenses, deleteExpense } = require('../controllers/expenseController');
const { authenticate } = require('../middlewares/auth');
const { isBendahara } = require('../middlewares/roleCheck');

router.use(authenticate);
router.use(isBendahara);

router.post('/', addExpense);
router.get('/', getExpenses);
router.delete('/:id', deleteExpense);

module.exports = router;
