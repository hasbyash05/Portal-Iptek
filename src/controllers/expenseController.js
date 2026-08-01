const { KasExpense, User } = require('../models');

const addExpense = async (req, res) => {
  try {
    const { amount, description, date } = req.body;
    if (!amount || !description || !date) {
      return res.status(400).json({ status: 'error', message: 'Semua field (amount, description, date) wajib diisi.' });
    }

    const expense = await KasExpense.create({
      amount: parseFloat(amount),
      description,
      date,
      created_by: req.user.id
    });

    return res.status(201).json({ status: 'success', message: 'Pengeluaran kas berhasil dicatat.', data: expense });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Terjadi kesalahan server.', error: err.message });
  }
};

const getExpenses = async (req, res) => {
  try {
    const expenses = await KasExpense.findAll({
      include: [{ model: User, as: 'creator', attributes: ['id', 'nama_lengkap'] }],
      order: [['date', 'DESC'], ['created_at', 'DESC']]
    });
    return res.status(200).json({ status: 'success', data: { items: expenses, total: expenses.length } });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Terjadi kesalahan server.', error: err.message });
  }
};

const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await KasExpense.findByPk(id);
    if (!expense) return res.status(404).json({ status: 'error', message: 'Pengeluaran tidak ditemukan.' });
    await expense.destroy();
    return res.status(200).json({ status: 'success', message: 'Pengeluaran berhasil dihapus.' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Terjadi kesalahan server.', error: err.message });
  }
};

module.exports = { addExpense, getExpenses, deleteExpense };
