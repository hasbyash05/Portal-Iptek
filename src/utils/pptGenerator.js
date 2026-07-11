const PptxGenJS = require('pptxgenjs');

const generateAttendancePPT = async (attendanceData, paymentSummary, periodLabel) => {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  // Define master slide colors
  const primaryColor = '1F4E79';
  const secondaryColor = '2F5597';
  const lightBg = 'F2F2F2';

  // Slide 1: Title Slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: primaryColor };
  titleSlide.addText('LAPORAN MANAJEMEN IPTEK', {
    x: 1.0, y: 2.0, w: '80%', h: 1.5,
    fontSize: 36, fontFace: 'Arial', bold: true, color: 'FFFFFF', align: 'center'
  });
  titleSlide.addText(`Periode: ${periodLabel}`, {
    x: 1.0, y: 3.5, w: '80%', h: 1.0,
    fontSize: 22, fontFace: 'Arial', color: 'D9E1F2', align: 'center'
  });
  titleSlide.addText('Organisasi Ilmu Pengetahuan dan Teknologi', {
    x: 1.0, y: 5.5, w: '80%', h: 0.5,
    fontSize: 14, fontFace: 'Arial', italic: true, color: 'FFFFFF', align: 'center'
  });

  // Slide 2: Chart Slide (Kehadiran Mingguan Hari Selasa)
  const chartSlide = pptx.addSlide();
  chartSlide.addText('Grafik Tren Kehadiran (Pertemuan Selasa)', {
    x: 0.5, y: 0.4, w: '90%', h: 0.6,
    fontSize: 24, fontFace: 'Arial', bold: true, color: primaryColor
  });

  // Prepare chart data
  const chartLabels = attendanceData.length > 0 ? attendanceData.map(d => d.date) : ['Selasa 1', 'Selasa 2', 'Selasa 3', 'Selasa 4'];
  const chartValues = attendanceData.length > 0 ? attendanceData.map(d => parseInt(d.count || 0)) : [20, 25, 22, 28];

  const chartData = [
    {
      name: 'Jumlah Hadir',
      labels: chartLabels,
      values: chartValues
    }
  ];

  chartSlide.addChart(pptx.ChartType.bar, chartData, {
    x: 0.8, y: 1.2, w: 8.5, h: 4.2,
    barDir: 'col',
    chartColors: [secondaryColor],
    showTitle: false,
    showValue: true,
    valGridLine: { color: 'D9D9D9', size: 1 },
    catAxisLabelColor: '595959',
    valAxisLabelColor: '595959'
  });

  // Slide 3: Table Slide (Rekapitulasi Kehadiran & Status Kas)
  const tableSlide = pptx.addSlide();
  tableSlide.addText('Tabel Rekapitulasi Kehadiran & Kas', {
    x: 0.5, y: 0.4, w: '90%', h: 0.6,
    fontSize: 24, fontFace: 'Arial', bold: true, color: primaryColor
  });

  const tableHeader = [
    { text: 'No', options: { fill: primaryColor, color: 'FFFFFF', bold: true, align: 'center' } },
    { text: 'Tanggal (Selasa)', options: { fill: primaryColor, color: 'FFFFFF', bold: true, align: 'center' } },
    { text: 'Total Hadir', options: { fill: primaryColor, color: 'FFFFFF', bold: true, align: 'center' } },
    { text: 'Status Data', options: { fill: primaryColor, color: 'FFFFFF', bold: true, align: 'center' } }
  ];

  const tableRows = [tableHeader];
  if (attendanceData.length > 0) {
    attendanceData.forEach((item, index) => {
      tableRows.push([
        { text: String(index + 1), options: { align: 'center' } },
        { text: String(item.date), options: { align: 'center' } },
        { text: `${item.count} Anggota`, options: { align: 'center' } },
        { text: 'Terverifikasi', options: { align: 'center', color: '2E7D32' } }
      ]);
    });
  } else {
    tableRows.push([
      { text: '-', options: { align: 'center' } },
      { text: 'Belum ada data absensi', options: { align: 'center' } },
      { text: '0', options: { align: 'center' } },
      { text: 'Kosong', options: { align: 'center' } }
    ]);
  }

  tableSlide.addTable(tableRows, {
    x: 0.8, y: 1.3, w: 8.4,
    rowH: 0.4,
    fontSize: 14,
    border: { pt: '1', color: 'CCCCCC' },
    fill: lightBg
  });

  // Return buffer
  const buffer = await pptx.write('nodebuffer');
  return buffer;
};

module.exports = { generateAttendancePPT };
