const { TeachingSchedule, TeachingMaterial, User, ScheduleMaterial } = require('../models');
const { Op } = require('sequelize');

/**
 * POST /api/materials/schedules
 * Pengurus membuat jadwal pertemuan baru.
 */
const createSchedule = async (req, res) => {
  try {
    const { date, topic, description, instructor_id, instructor_name } = req.body;

    if (!date || !topic || (!instructor_id && !instructor_name)) {
      return res.status(400).json({
        status: 'error',
        message: 'Tanggal, topik, dan pemateri wajib diisi.'
      });
    }

    let finalInstructorId = null;
    let finalInstructorName = null;

    if (instructor_id && instructor_id !== 'other') {
      const instructor = await User.findByPk(instructor_id);
      if (!instructor) {
        return res.status(400).json({
          status: 'error',
          message: 'Pemateri yang dipilih tidak ditemukan.'
        });
      }
      finalInstructorId = instructor.id;
    } else if (instructor_name) {
      finalInstructorName = instructor_name;
    } else {
      return res.status(400).json({
        status: 'error',
        message: 'Nama pemateri wajib diisi.'
      });
    }

    const schedule = await TeachingSchedule.create({
      date,
      topic,
      description: description || null,
      instructor_id: finalInstructorId,
      instructor_name: finalInstructorName,
      material_id: null,
      created_by: req.user.id
    });

    // Reload with associations
    const result = await TeachingSchedule.findByPk(schedule.id, {
      include: [
        { model: User, as: 'instructor', attributes: ['id', 'nama_lengkap', 'divisi'] },
        { model: User, as: 'creator', attributes: ['id', 'nama_lengkap'] },
        { model: TeachingMaterial, as: 'material', attributes: ['id', 'title', 'file_path'] }
      ]
    });

    const formatted = result.toJSON();
    if (!formatted.instructor && formatted.instructor_name) {
      formatted.instructor = {
        id: null,
        nama_lengkap: formatted.instructor_name,
        divisi: 'Dosen / Pemateri Tamu'
      };
    }

    return res.status(201).json({
      status: 'success',
      message: 'Jadwal pertemuan berhasil dibuat.',
      data: formatted
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat membuat jadwal.',
      error: error.message
    });
  }
};

/**
 * GET /api/materials/schedules
 * Semua user melihat jadwal pertemuan.
 */
const getSchedules = async (req, res) => {
  try {
    const schedules = await TeachingSchedule.findAll({
      include: [
        { model: User, as: 'instructor', attributes: ['id', 'nama_lengkap', 'divisi'] },
        { model: User, as: 'creator', attributes: ['id', 'nama_lengkap'] },
        { model: TeachingMaterial, as: 'material', attributes: ['id', 'title', 'file_path'] },
        { model: TeachingMaterial, as: 'materials', attributes: ['id', 'title', 'file_path'] }
      ],
      order: [['date', 'DESC']]
    });

    const formatted = schedules.map(s => {
      const item = s.toJSON();
      const list = [];
      if (item.materials && Array.isArray(item.materials)) {
        list.push(...item.materials);
      }
      if (item.material && !list.some(m => m.id === item.material.id)) {
        list.push(item.material);
      }
      item.materials = list;

      if (!item.instructor && item.instructor_name) {
        item.instructor = {
          id: null,
          nama_lengkap: item.instructor_name,
          divisi: 'Dosen / Pemateri Tamu'
        };
      }

      return item;
    });

    return res.status(200).json({
      status: 'success',
      data: formatted
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil jadwal.',
      error: error.message
    });
  }
};

/**
 * PUT /api/materials/schedules/:id/link
 * Pengurus menautkan materi ke jadwal (mendukung banyak file).
 */
const linkMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { material_id } = req.body;

    const schedule = await TeachingSchedule.findByPk(id);
    if (!schedule) {
      return res.status(404).json({
        status: 'error',
        message: 'Jadwal tidak ditemukan.'
      });
    }

    if (material_id) {
      const material = await TeachingMaterial.findByPk(material_id);
      if (!material) {
        return res.status(404).json({
          status: 'error',
          message: 'Materi tidak ditemukan.'
        });
      }

      await ScheduleMaterial.findOrCreate({
        where: { schedule_id: id, material_id }
      });
      schedule.material_id = material_id;
      await schedule.save();
    }

    return res.status(200).json({
      status: 'success',
      message: 'Materi berhasil ditautkan ke jadwal.'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menautkan materi.',
      error: error.message
    });
  }
};

/**
 * DELETE /api/materials/schedules/:scheduleId/link/:materialId
 * Pengurus melepas tautan satu file materi dari jadwal.
 */
const unlinkMaterial = async (req, res) => {
  try {
    const { scheduleId, materialId } = req.params;
    await ScheduleMaterial.destroy({
      where: { schedule_id: scheduleId, material_id: materialId }
    });
    const schedule = await TeachingSchedule.findByPk(scheduleId);
    if (schedule && schedule.material_id == materialId) {
      schedule.material_id = null;
      await schedule.save();
    }
    return res.status(200).json({
      status: 'success',
      message: 'Tautan materi berhasil dilepas dari jadwal.'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat melepas tautan materi.',
      error: error.message
    });
  }
};

/**
 * DELETE /api/materials/schedules/:id
 * Pengurus menghapus jadwal.
 */
const deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await TeachingSchedule.findByPk(id);

    if (!schedule) {
      return res.status(404).json({
        status: 'error',
        message: 'Jadwal tidak ditemukan.'
      });
    }

    await schedule.destroy();

    return res.status(200).json({
      status: 'success',
      message: 'Jadwal pertemuan berhasil dihapus.'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menghapus jadwal.',
      error: error.message
    });
  }
};

/**
 * GET /api/materials/instructors
 * Ambil daftar pengurus untuk dropdown pemateri.
 */
const getInstructors = async (req, res) => {
  try {
    const instructors = await User.findAll({
      where: { role: 'pengurus' },
      attributes: ['id', 'nama_lengkap', 'divisi'],
      order: [['nama_lengkap', 'ASC']]
    });

    return res.status(200).json({
      status: 'success',
      data: instructors
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil daftar pemateri.'
    });
  }
};

module.exports = { createSchedule, getSchedules, linkMaterial, unlinkMaterial, deleteSchedule, getInstructors };
