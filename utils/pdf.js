import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function generateExitAuthPDF(data, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // --- Header ---
      doc.fontSize(20).text('AUTORISATION DE SORTIE', { align: 'center', underline: true });
      doc.moveDown();

      doc.fontSize(12).text(`Référence: ${data.id.toUpperCase()}`, { align: 'right' });
      doc.moveDown();

      // --- Employee Info ---
      doc.fontSize(14).text('INFORMATIONS SUR L\'EMPLOYÉ', { underline: true });
      doc.fontSize(12).text(`Nom et Prénom: ${data.empName}`);
      doc.moveDown();

      // --- Exit Details ---
      doc.fontSize(14).text('DÉTAILS DE LA SORTIE', { underline: true });
      doc.fontSize(12).text(`Type de sortie: ${data.exitType}`);
      doc.fontSize(12).text(`Motif: ${data.reason}`);
      doc.fontSize(12).text(`Date de demande: ${new Date(data.createdAt).toLocaleString()}`);
      doc.moveDown(2);

      // --- Signatures Section ---
      doc.fontSize(14).text('SIGNATURES ET APPROBATIONS', { underline: true });
      doc.moveDown();

      const yPos = doc.y;
      const colWidth = 160;

      // Column 1: Manager
      doc.fontSize(10).text('LE MANAGER', 50, yPos);
      doc.fontSize(10).text(`Nom: ${data.managerName}`, 50, yPos + 15);
      doc.fontSize(10).italic().text('[Signé électroniquement]', 50, yPos + 30);

      // Column 2: Admin/RH
      doc.fontSize(10).text('L\'ADMINISTRATION / RH', 50 + colWidth + 20, yPos);
      doc.fontSize(10).text(`Nom: ${data.adminApprovedBy || '—'}`, 50 + colWidth + 20, yPos + 15);
      doc.fontSize(10).italic().text('[Signé électroniquement]', 50 + colWidth + 20, yPos + 30);

      // Column 3: Guard
      doc.fontSize(10).text('POSTE DE GARDE', 50 + (colWidth * 2) + 40, yPos);
      doc.fontSize(10).text(`Nom: ${data.guardConfirmedBy || '—'}`, 50 + (colWidth * 2) + 40, yPos + 15);
      doc.fontSize(10).italic().text('[Signé électroniquement]', 50 + (colWidth * 2) + 40, yPos + 30);

      doc.moveDown(4);
      doc.fontSize(10).text(`Document généré le ${new Date().toLocaleString()} par TewfikSoft HR System.`, { align: 'center', color: 'grey' });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}
