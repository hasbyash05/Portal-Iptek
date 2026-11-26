use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Debug, Clone)]
pub struct AttendanceChartRow {
    pub date: String,
    pub count: i64,
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Pure Rust PowerPoint (.pptx) OpenXML generator matching the original 3-slide layout:
/// Slide 1: Title Slide (16:9, #1F4E79 background)
/// Slide 2: Bar Chart Slide (native OOXML bar chart)
/// Slide 3: Recap Table Slide (native OOXML table)
pub fn generate_attendance_ppt(
    attendance_data: &[AttendanceChartRow],
    period_label: &str,
) -> Result<Vec<u8>, String> {
    let buf = Vec::new();
    let cursor = Cursor::new(buf);
    let mut zip = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut write_entry = |name: &str, content: &str| -> Result<(), String> {
        zip.start_file(name, options)
            .map_err(|e| format!("zip start_file {}: {}", name, e))?;
        zip.write_all(content.as_bytes())
            .map_err(|e| format!("zip write {}: {}", name, e))?;
        Ok(())
    };

    // 1. [Content_Types].xml
    write_entry(
        "[Content_Types].xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>"#,
    )?;

    // 2. _rels/.rels
    write_entry(
        "_rels/.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"#,
    )?;

    // 3. ppt/presentation.xml (16:9 -> 9144000 x 5143500 EMU = 10in x 5.625in)
    write_entry(
        "ppt/presentation.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
    <p:sldId id="258" r:id="rId4"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"#,
    )?;

    // 4. ppt/_rels/presentation.xml.rels
    write_entry(
        "ppt/_rels/presentation.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>"#,
    )?;

    // 5. Slide Master, Layout, Theme
    write_entry(
        "ppt/slideMasters/slideMaster1.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>"#,
    )?;

    write_entry(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>"#,
    )?;

    write_entry(
        "ppt/slideLayouts/slideLayout1.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
    </p:spTree>
  </p:cSld>
</p:sldLayout>"#,
    )?;

    write_entry(
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>"#,
    )?;

    write_entry(
        "ppt/theme/theme1.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="IPTEK Theme">
  <a:themeElements>
    <a:clrScheme name="IPTEK">
      <a:dk1><a:srgbClr val="000000"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F4E79"/></a:dk2>
      <a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>
      <a:accent1><a:srgbClr val="2F5597"/></a:accent1>
      <a:accent2><a:srgbClr val="1F4E79"/></a:accent2>
      <a:accent3><a:srgbClr val="595959"/></a:accent3>
      <a:accent4><a:srgbClr val="2E7D32"/></a:accent4>
      <a:accent5><a:srgbClr val="D9E1F2"/></a:accent5>
      <a:accent6><a:srgbClr val="CCCCCC"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Arial">
      <a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Basic">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>"#,
    )?;

    // 6. Slide 1: Title Slide
    let escaped_period = xml_escape(&format!("Periode: {}", period_label));
    let slide1 = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="1F4E79"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="1600000"/><a:ext cx="7315200" cy="1100000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" anchor="ctr"/>
          <a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="id-ID" sz="3600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>LAPORAN MANAJEMEN IPTEK</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Subtitle"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="2800000"/><a:ext cx="7315200" cy="700000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" anchor="ctr"/>
          <a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="id-ID" sz="2200"><a:solidFill><a:srgbClr val="D9E1F2"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>{}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="4" name="Footer"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="4200000"/><a:ext cx="7315200" cy="450000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" anchor="ctr"/>
          <a:lstStyle/>
          <a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="id-ID" sz="1400" i="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>Organisasi Ilmu Pengetahuan dan Teknologi</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>"#,
        escaped_period
    );
    write_entry("ppt/slides/slide1.xml", &slide1)?;
    write_entry(
        "ppt/slides/_rels/slide1.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"#,
    )?;

    // 7. Slide 2: Chart Slide + Chart XML
    let chart_rows: Vec<(String, i64)> = if !attendance_data.is_empty() {
        attendance_data
            .iter()
            .map(|r| (r.date.clone(), r.count))
            .collect()
    } else {
        vec![
            ("Selasa 1".to_string(), 0),
            ("Selasa 2".to_string(), 0),
            ("Selasa 3".to_string(), 0),
            ("Selasa 4".to_string(), 0),
        ]
    };

    let mut cat_pts = String::new();
    let mut val_pts = String::new();
    for (idx, (label, val)) in chart_rows.iter().enumerate() {
        cat_pts.push_str(&format!(
            r#"<c:pt idx="{}"><c:v>{}</c:v></c:pt>"#,
            idx,
            xml_escape(label)
        ));
        val_pts.push_str(&format!(
            r#"<c:pt idx="{}"><c:v>{}</c:v></c:pt>"#,
            idx, val
        ));
    }

    let chart_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:v>Jumlah Hadir</c:v></c:tx>
          <c:spPr><a:solidFill><a:srgbClr val="2F5597"/></a:solidFill></c:spPr>
          <c:dLbls><c:showVal val="1"/></c:dLbls>
          <c:cat><c:strLit><c:ptCount val="{cnt}"/>{cat}</c:strLit></c:cat>
          <c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="{cnt}"/>{val}</c:numLit></c:val>
        </c:ser>
        <c:axId val="48650112"/>
        <c:axId val="48672768"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="48650112"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="48672768"/>
        <c:crosses val="autoZero"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="48672768"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines><c:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="48650112"/>
        <c:crosses val="autoZero"/>
      </c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="b"/></c:legend>
  </c:chart>
</c:chartSpace>"#,
        cnt = chart_rows.len(),
        cat = cat_pts,
        val = val_pts
    );
    write_entry("ppt/charts/chart1.xml", &chart_xml)?;

    let slide2 = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="365760"/><a:ext cx="8229600" cy="548640"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="id-ID" sz="2400" b="1"><a:solidFill><a:srgbClr val="1F4E79"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>Grafik Tren Kehadiran (Pertemuan Selasa)</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="3" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="731520" y="1097280"/><a:ext cx="7772400" cy="3657600"/></p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
            <c:chart r:id="rId2"/>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
</p:sld>"#;
    write_entry("ppt/slides/slide2.xml", slide2)?;
    write_entry(
        "ppt/slides/_rels/slide2.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>"#,
    )?;

    // 8. Slide 3: Recap Table Slide
    let make_cell = |text: &str, fill_hex: &str, text_hex: &str, bold: bool| -> String {
        let b_attr = if bold { r#" b="1""# } else { "" };
        format!(
            r#"<a:tc><a:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="id-ID" sz="1400"{b}><a:solidFill><a:srgbClr val="{fg}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>{txt}</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnL w="12700"><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill></a:lnL><a:lnR w="12700"><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill></a:lnR><a:lnT w="12700"><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill></a:lnT><a:lnB w="12700"><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="{bg}"/></a:solidFill></a:tcPr></a:tc>"#,
            b = b_attr,
            fg = text_hex,
            txt = xml_escape(text),
            bg = fill_hex
        )
    };

    let mut rows_xml = String::new();
    rows_xml.push_str(&format!(
        r#"<a:tr h="365760">{}{}{}{}</a:tr>"#,
        make_cell("No", "1F4E79", "FFFFFF", true),
        make_cell("Tanggal (Selasa)", "1F4E79", "FFFFFF", true),
        make_cell("Total Hadir", "1F4E79", "FFFFFF", true),
        make_cell("Status Data", "1F4E79", "FFFFFF", true),
    ));

    if !attendance_data.is_empty() {
        for (idx, item) in attendance_data.iter().enumerate() {
            rows_xml.push_str(&format!(
                r#"<a:tr h="365760">{}{}{}{}</a:tr>"#,
                make_cell(&(idx + 1).to_string(), "F2F2F2", "18181B", false),
                make_cell(&item.date, "F2F2F2", "18181B", false),
                make_cell(&format!("{} Anggota", item.count), "F2F2F2", "18181B", false),
                make_cell("Terverifikasi", "F2F2F2", "2E7D32", false),
            ));
        }
    } else {
        rows_xml.push_str(&format!(
            r#"<a:tr h="365760">{}{}{}{}</a:tr>"#,
            make_cell("-", "F2F2F2", "18181B", false),
            make_cell("Belum ada data absensi", "F2F2F2", "18181B", false),
            make_cell("0", "F2F2F2", "18181B", false),
            make_cell("Kosong", "F2F2F2", "18181B", false),
        ));
    }

    let slide3 = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="365760"/><a:ext cx="8229600" cy="548640"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="id-ID" sz="2400" b="1"><a:solidFill><a:srgbClr val="1F4E79"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>Tabel Rekapitulasi Kehadiran &amp; Kas</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="3" name="Table 1"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="731520" y="1188720"/><a:ext cx="7680960" cy="3000000"/></p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tblPr firstRow="1" bandRow="1"/>
              <a:tblGrid>
                <a:gridCol w="1000000"/>
                <a:gridCol w="2400000"/>
                <a:gridCol w="2140480"/>
                <a:gridCol w="2140480"/>
              </a:tblGrid>
              {rows}
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
</p:sld>"#,
        rows = rows_xml
    );
    write_entry("ppt/slides/slide3.xml", &slide3)?;
    write_entry(
        "ppt/slides/_rels/slide3.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"#,
    )?;

    let cursor = zip
        .finish()
        .map_err(|e| format!("zip finish error: {}", e))?;
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use zip::ZipArchive;

    #[test]
    fn generates_valid_pptx_zip_archive() {
        let rows = vec![
            AttendanceChartRow {
                date: "2026-11-03".to_string(),
                count: 18,
            },
            AttendanceChartRow {
                date: "2026-11-10".to_string(),
                count: 24,
            },
        ];
        let bytes = generate_attendance_ppt(&rows, "Bulan 11 Tahun 2026").expect("pptx generation");
        assert!(bytes.len() > 500);

        let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("valid zip archive");
        let mut slide3 = String::new();
        archive
            .by_name("ppt/slides/slide3.xml")
            .expect("slide3 present")
            .read_to_string(&mut slide3)
            .expect("read slide3");
        assert!(slide3.contains("2026-11-03"));
        assert!(slide3.contains("24 Anggota"));

        let mut chart1 = String::new();
        archive
            .by_name("ppt/charts/chart1.xml")
            .expect("chart1 present")
            .read_to_string(&mut chart1)
            .expect("read chart1");
        assert!(chart1.contains("Jumlah Hadir"));
        assert!(chart1.contains("2026-11-10"));
    }
}
