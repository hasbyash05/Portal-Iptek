const { sequelize } = require('../config/database');
const { User } = require('./User');
const { WeeklyReport } = require('./WeeklyReport');
const { TeachingMaterial } = require('./TeachingMaterial');
const { Attendance } = require('./Attendance');
const { Payment } = require('./Payment');

// Associations
User.hasMany(WeeklyReport, { foreignKey: 'user_id', as: 'reports' });
WeeklyReport.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(TeachingMaterial, { foreignKey: 'user_id', as: 'materials' });
TeachingMaterial.belongsTo(User, { foreignKey: 'user_id', as: 'uploader' });

User.hasMany(Attendance, { foreignKey: 'user_id', as: 'attendances' });
Attendance.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

User.hasMany(Payment, { foreignKey: 'user_id', as: 'payments' });
Payment.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Confirmed_by association for payments
User.hasMany(Payment, { foreignKey: 'confirmed_by', as: 'confirmedPayments' });
Payment.belongsTo(User, { foreignKey: 'confirmed_by', as: 'verifier' });

module.exports = {
  sequelize,
  User,
  WeeklyReport,
  TeachingMaterial,
  Attendance,
  Payment
};
