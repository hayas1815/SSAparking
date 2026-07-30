/**
 * Report Export Utility
 * Supports: CSV, genuine XLSX (via exceljs), genuine PDF (via pdfkit), and printable HTML.
 */

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// ─── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Convert an array of row objects to RFC-4180 compliant CSV.
 * Applies formula injection defense (OWASP CSV Injection prevention).
 * @param {object[]} rows - Array of flat objects
 * @param {string[]} [columns] - Column order; defaults to keys of first row
 * @returns {string} CSV string
 */
function toCSV(rows, columns) {
  if (!rows || rows.length === 0) return '';
  const cols = columns || Object.keys(rows[0]);

  // Formula injection prefixes per OWASP CSV injection prevention guide
  const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

  const escapeCell = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val);
    // Prefix with single-quote to neutralise any spreadsheet formula injection
    if (FORMULA_PREFIXES.some(p => str.startsWith(p))) {
      str = `'${str}`;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = cols.join(',');
  const bodyLines = rows.map(row => cols.map(c => escapeCell(row[c])).join(','));
  return [header, ...bodyLines].join('\r\n');
}

// ─── XLSX (genuine Excel workbook via exceljs) ────────────────────────────────

/**
 * Sanitize a cell value to prevent formula injection in spreadsheets.
 * @param {*} val
 * @returns {*} sanitized value
 */
function sanitizeXlsxCell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  const str = String(val);
  const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];
  if (FORMULA_PREFIXES.some(p => str.startsWith(p))) {
    return `'${str}`;
  }
  return str;
}

/**
 * Generate a real .xlsx workbook as a Buffer.
 * @param {object[]} rows - Array of flat objects
 * @param {string} title - Report title / sheet name
 * @param {string[]} [columns] - Column order
 * @returns {Promise<Buffer>} XLSX file buffer
 */
async function toXLSX(rows, title, columns) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SSA Two-Wheeler Parking System';
  workbook.created = new Date();

  const sheetName = (title || 'Report').substring(0, 31); // Excel sheet name max 31 chars
  const sheet = workbook.addWorksheet(sheetName);

  const cols = columns || (rows.length > 0 ? Object.keys(rows[0]) : []);

  // Title row
  sheet.mergeCells(1, 1, 1, cols.length || 1);
  const titleCell = sheet.getCell('A1');
  titleCell.value = `SSA Two-Wheeler Parking — ${title || 'Report'}`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1A1A2E' } };
  titleCell.alignment = { horizontal: 'center' };

  // Timestamp row
  sheet.mergeCells(2, 1, 2, cols.length || 1);
  const tsCell = sheet.getCell('A2');
  tsCell.value = `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
  tsCell.font = { italic: true, size: 10, color: { argb: 'FF666666' } };

  // Header row (row 4)
  const headerRow = sheet.getRow(4);
  cols.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
    cell.alignment = { horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF333333' } }
    };
  });

  // Currency and date column detection
  const currencyCols = new Set(['rate', 'fine_amount', 'total_amount', 'total_revenue', 'cash_revenue', 'gpay_revenue', 'upi_revenue', 'card_revenue', 'total_fine', 'avg_revenue']);
  const dateCols = new Set(['in_date', 'exit_date', 'collection_date']);

  // Data rows
  rows.forEach((row, rowIdx) => {
    const dataRow = sheet.getRow(rowIdx + 5);
    cols.forEach((col, colIdx) => {
      const cell = dataRow.getCell(colIdx + 1);
      let val = row[col];

      if (currencyCols.has(col) && val !== null && val !== undefined) {
        const num = parseFloat(val);
        if (!isNaN(num)) {
          cell.value = num;
          cell.numFmt = '₹#,##0.00';
        } else {
          cell.value = sanitizeXlsxCell(val);
        }
      } else if (dateCols.has(col)) {
        cell.value = sanitizeXlsxCell(val);
        cell.alignment = { horizontal: 'center' };
      } else {
        cell.value = sanitizeXlsxCell(val);
      }
    });

    // Alternate row shading
    if (rowIdx % 2 === 1) {
      cols.forEach((_, colIdx) => {
        dataRow.getCell(colIdx + 1).fill = {
          type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' }
        };
      });
    }
  });

  // Auto-fit columns (approximate)
  cols.forEach((col, idx) => {
    const maxLen = Math.max(
      col.length,
      ...rows.slice(0, 100).map(r => String(r[col] || '').length)
    );
    sheet.getColumn(idx + 1).width = Math.min(Math.max(maxLen + 2, 10), 40);
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── PDF (genuine PDF via pdfkit) ─────────────────────────────────────────────

/**
 * Sanitize a value for safe PDF output.
 */
function sanitizePdfValue(val) {
  if (val === null || val === undefined) return '';
  return String(val);
}

/**
 * Generate a real PDF document as a Buffer.
 * @param {object[]} rows - Array of flat objects
 * @param {string} title - Report title
 * @param {object} [summary] - Summary stats object
 * @param {string[]} [columns] - Column order
 * @returns {Promise<Buffer>} PDF buffer
 */
function toPDF(rows, title, summary, columns) {
  return new Promise((resolve, reject) => {
    try {
      const cols = columns || (rows.length > 0 ? Object.keys(rows[0]) : []);
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Title
      doc.fontSize(16).font('Helvetica-Bold')
         .text(`SSA Two-Wheeler Parking — ${title || 'Report'}`, { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(9).font('Helvetica')
         .fillColor('#666666')
         .text(`Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, { align: 'center' });
      doc.fillColor('#000000');
      doc.moveDown(0.5);

      // Summary
      if (summary) {
        doc.fontSize(10).font('Helvetica-Bold').text('Summary:', { underline: true });
        doc.font('Helvetica').fontSize(9);
        for (const [key, value] of Object.entries(summary)) {
          doc.text(`  ${key}: ${sanitizePdfValue(value)}`);
        }
        doc.moveDown(0.5);
      }

      // Table
      if (cols.length > 0 && rows.length > 0) {
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const colWidth = Math.floor(pageWidth / cols.length);
        const fontSize = Math.min(8, Math.max(5, Math.floor(120 / cols.length)));

        // Header
        const headerY = doc.y;
        doc.fontSize(fontSize).font('Helvetica-Bold');
        cols.forEach((col, i) => {
          const label = col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          doc.text(
            label.substring(0, Math.floor(colWidth / (fontSize * 0.5))),
            doc.page.margins.left + i * colWidth,
            headerY,
            { width: colWidth - 2, align: 'left', lineBreak: false }
          );
        });

        doc.moveTo(doc.page.margins.left, headerY + fontSize + 4)
           .lineTo(doc.page.margins.left + pageWidth, headerY + fontSize + 4)
           .stroke('#333333');

        doc.y = headerY + fontSize + 8;

        // Data rows (limit to prevent massive PDFs)
        const maxPdfRows = Math.min(rows.length, 500);
        doc.font('Helvetica').fontSize(fontSize);

        for (let r = 0; r < maxPdfRows; r++) {
          const row = rows[r];
          const rowY = doc.y;

          // Check if we need a new page
          if (rowY + fontSize + 6 > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
          }

          const currentY = doc.y;
          cols.forEach((col, i) => {
            const val = sanitizePdfValue(row[col]);
            doc.text(
              val.substring(0, Math.floor(colWidth / (fontSize * 0.5))),
              doc.page.margins.left + i * colWidth,
              currentY,
              { width: colWidth - 2, align: 'left', lineBreak: false }
            );
          });
          doc.y = currentY + fontSize + 3;
        }

        if (rows.length > maxPdfRows) {
          doc.moveDown(0.5);
          doc.fontSize(8).fillColor('#999999')
             .text(`... and ${rows.length - maxPdfRows} more rows (truncated for PDF). Use CSV or XLSX for full export.`);
        }
      } else {
        doc.fontSize(10).text('No data available for this report.');
      }

      // Footer with total count
      doc.moveDown(1);
      doc.fontSize(8).fillColor('#666666')
         .text(`Total Records: ${rows.length} | SSA Two-Wheeler Parking Management System`);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Printable HTML (kept for browser print) ──────────────────────────────────

/**
 * Generate a printable HTML report (can be printed from browser).
 * NOT labeled as PDF — this is explicitly "Printable HTML".
 */
function toPrintableHTML(rows, title, summary, columns) {
  const cols = columns || (rows.length > 0 ? Object.keys(rows[0]) : []);

  const escapeHtml = (val) => {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  const summaryRows = summary
    ? Object.entries(summary)
        .map(([k, v]) => `<tr><td><b>${escapeHtml(k)}</b></td><td>${escapeHtml(v)}</td></tr>`)
        .join('\n')
    : '';

  const headerRow = `<tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  const bodyRows = rows.map(row =>
    `<tr>${cols.map(c => `<td>${escapeHtml(row[c])}</td>`).join('')}</tr>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; color: #333; }
  h2 { color: #1a1a2e; margin-bottom: 4px; }
  .meta { color: #666; font-size: 11px; margin-bottom: 16px; }
  .summary { margin-bottom: 16px; }
  .summary table { border-collapse: collapse; }
  .summary td { padding: 4px 12px 4px 0; }
  table.data { width: 100%; border-collapse: collapse; }
  table.data th { background: #1a1a2e; color: white; padding: 6px 8px; text-align: left; font-size: 11px; }
  table.data td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
  table.data tr:nth-child(even) { background: #f9f9f9; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h2>SSA Two-Wheeler Parking — ${escapeHtml(title)}</h2>
<div class="meta">Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
${summary ? `<div class="summary"><table>${summaryRows}</table></div>` : ''}
<table class="data">
<thead>${headerRow}</thead>
<tbody>${bodyRows}</tbody>
</table>
</body></html>`;
}

// ─── Export Dispatcher ────────────────────────────────────────────────────────

/**
 * Send an export response to the client.
 * @param {object} res - Express response
 * @param {'csv'|'excel'|'xlsx'|'pdf'|'printable'} format - Export format
 * @param {object[]} rows - Data rows
 * @param {string} filename - File basename (without extension)
 * @param {string} title - Report title
 * @param {object} [summary] - Optional summary stats
 * @param {string[]} [columns] - Column order
 */
async function sendExport(res, format, rows, filename, title, summary, columns) {
  // Sanitize filename: allow only alphanumeric, dashes, and underscores
  const safeFilename = (filename || 'export').replace(/[^a-zA-Z0-9_-]/g, '_');

  if (format === 'csv') {
    const csv = toCSV(rows, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.csv"`);
    return res.send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
  }

  if (format === 'excel' || format === 'xlsx') {
    const buffer = await toXLSX(rows, title, columns);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.xlsx"`);
    return res.send(buffer);
  }

  if (format === 'pdf') {
    const buffer = await toPDF(rows, title, summary, columns);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}.pdf"`);
    return res.send(buffer);
  }

  if (format === 'printable') {
    const html = toPrintableHTML(rows, title, summary, columns);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}.html"`);
    return res.send(html);
  }

  res.status(400).json({ success: false, message: `Unsupported export format: ${format}. Use csv, excel, pdf, or printable.` });
}

module.exports = { toCSV, toXLSX, toPDF, toPrintableHTML, sendExport };
