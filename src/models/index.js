const { sequelize } = require('../config/database');
const { User } = require('./User');
const { WeeklyReport } = require('./WeeklyReport');
const { TeachingMaterial } = require('./TeachingMaterial');
const { Attendance } = require('./Attendance');
const { Payment } = require('./Payment');
const { AttendanceSession } = require('./AttendanceSession');
const { UserDevice } = require('./UserDevice');
const { TeachingSchedule } = require('./TeachingSchedule');

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

// AttendanceSession - activated_by association
AttendanceSession.belongsTo(User, { foreignKey: 'activated_by', as: 'activator' });

// UserDevice - user association
User.hasMany(UserDevice, { foreignKey: 'user_id', as: 'devices' });
UserDevice.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// TeachingSchedule associations
TeachingSchedule.belongsTo(User, { foreignKey: 'instructor_id', as: 'instructor' });
TeachingSchedule.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
TeachingSchedule.belongsTo(TeachingMaterial, { foreignKey: 'material_id', as: 'material' });

const { ScheduleMaterial } = require('./ScheduleMaterial');
TeachingSchedule.belongsToMany(TeachingMaterial, {
  through: ScheduleMaterial,
  foreignKey: 'schedule_id',
  otherKey: 'material_id',
  as: 'materials'
});
TeachingMaterial.belongsToMany(TeachingSchedule, {
  through: ScheduleMaterial,
  foreignKey: 'material_id',
  otherKey: 'schedule_id',
  as: 'schedules'
});

const { DocumentTemplate } = require('./DocumentTemplate');
User.hasMany(DocumentTemplate, { foreignKey: 'uploaded_by', as: 'templates' });
DocumentTemplate.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploader' });

module.exports = {
  sequelize,
  User,
  WeeklyReport,
  TeachingMaterial,
  Attendance,
  Payment,
  AttendanceSession,
  UserDevice,
  TeachingSchedule,
  ScheduleMaterial,
  DocumentTemplate
};
