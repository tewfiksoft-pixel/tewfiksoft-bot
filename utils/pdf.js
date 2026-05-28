import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import arabicReshaper from 'arabic-reshaper';
import bidiFactory from 'bidi-js';
import https from 'https';
import { loadDB } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bidi = bidiFactory();

async function downloadQRCode(text, tempQrPath) {
  return new Promise((resolve, reject) => {
    const encodedText = encodeURIComponent(text);
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodedText}`;
    const file = fs.createWriteStream(tempQrPath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get QR code: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(tempQrPath);
      });
    }).on('error', (err) => {
      fs.unlink(tempQrPath, () => {});
      reject(err);
    });
  });
}

export async function generateExitAuthPDF(data, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Use standard fonts for 100% French document
      const fontBold = 'Helvetica-Bold';
      const fontNormal = 'Helvetica';
      const logoPath = path.join(__dirname, '..', '..', 'src-tauri', 'icons', 'icon.png');

      // --- Header / Dynamic Company Logo (Text) ---
      const companyName = data.companyName || 'ALVER / TEWFIKSOFT';
      
      // Company name at the top center
      doc.font(fontBold).fontSize(20).fillColor('#1a5f7a').text(companyName.toUpperCase(), 50, 40, { align: 'center', width: 500 });
      doc.font(fontNormal).fontSize(10).fillColor('#666').text('Gestion des Ressources Humaines - Système Professionnel', 50, 65, { align: 'center', width: 500 });
      
      doc.moveTo(50, 85).lineTo(545, 85).strokeColor('#1a5f7a').lineWidth(2).stroke();

      // Title below the line
      doc.moveDown(1);
      doc.font(fontBold).fontSize(18).fillColor('#1a5f7a').text('AUTORISATION DE SORTIE', { align: 'center' });

      // --- Meta Info ---
      doc.moveDown(1);
      doc.font(fontNormal).fontSize(9).fillColor('#333');
      doc.text(`Référence: ${data.id.toUpperCase()}`, { align: 'right' });
      doc.text(`Généré le: ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, { align: 'right' });

      // --- Employee Section ---
      doc.moveDown(1);
      const startY1 = doc.y;
      doc.rect(50, startY1, 495, 20).fill('#f8fbfc');
      doc.fillColor('#1a5f7a').fontSize(10).font(fontBold).text("DÉTAILS DE L'EMPLOYÉ", 60, startY1 + 5);
      
      doc.moveDown(0.8);
      doc.fillColor('#333').fontSize(11).font(fontNormal);
      doc.text(`Nom et Prénom:`, 60, doc.y, { continued: true }).font(fontBold).text(`  ${data.empName.toUpperCase()}`);

      // --- Details Section ---
      doc.moveDown(1.5);
      const startY2 = doc.y;
      doc.rect(50, startY2, 495, 20).fill('#f8fbfc');
      doc.fillColor('#1a5f7a').fontSize(10).font(fontBold).text('DÉTAILS DE LA SORTIE', 60, startY2 + 5);
      
      doc.moveDown(0.8);
      const exitTypeTxt = data.exitType === 'Service' ? 'Mission de Service' : 'Sortie Personnelle';
      const officialExitTime = data.guardConfirmedAt 
        ? new Date(data.guardConfirmedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : data.exitTime;

      doc.fillColor('#333').fontSize(10).font(fontNormal);
      doc.text(`Type de Sortie: `, 60, doc.y, { continued: true }).font(fontBold).text(exitTypeTxt);
      doc.font(fontNormal).text(`Heure de Sortie (Réelle): `, 60, doc.y + 5, { continued: true }).font(fontBold).fillColor('#d9534f').text(officialExitTime);
      doc.fillColor('#333').font(fontNormal).text(`Motif / Raison: `, 60, doc.y + 5, { continued: true }).font(fontBold).text(data.reason);
      doc.font(fontNormal).text(`Date de Demande: `, 60, doc.y + 5, { continued: true }).font(fontBold).text(new Date(data.createdAt).toLocaleString('fr-FR'));

      // --- Signatures Section ---
      doc.moveDown(4);
      doc.rect(50, doc.y, 495, 1).fill('#eee');
      doc.moveDown(1);
      doc.fontSize(11).font(fontBold).fillColor('#1a5f7a').text('VALIDATIONS ET SIGNATURES ÉLECTRONIQUES', { align: 'center' });
      doc.moveDown(1.5);

      const yPos = doc.y;
      const stampWidth = 150;
      const spacing = 15;

      // Fixed Attractive Stamp Designer
      const drawAttractiveStamp = (x, y, label, name, color) => {
        doc.roundedRect(x, y, stampWidth, 85, 5).lineWidth(1.5).strokeColor(color).stroke();
        
        // Header of Stamp
        doc.rect(x + 1, y + 1, stampWidth - 2, 16).fill(color);
        doc.fontSize(8).fillColor('#fff').font(fontBold).text(label, x, y + 5, { width: stampWidth, align: 'center' });
        
        // Signatory Name
        doc.fontSize(7).fillColor('#666').font(fontNormal).text('Signé par:', x + 5, y + 22);
        doc.fontSize(8.5).fillColor(color).font(fontBold).text(name, x + 5, y + 32, { width: stampWidth - 10, align: 'center' });
        
        // Security Text (Better spacing)
        doc.fontSize(7).fillColor(color).font('Helvetica-Oblique').text('DOCUMENT VÉRIFIÉ', x, y + 55, { width: stampWidth, align: 'center' });
        doc.fontSize(6).fillColor('#999').font(fontNormal).text(`ID: ${data.id.slice(0,8)} | ${new Date().toLocaleTimeString('fr-FR')}`, x, y + 68, { width: stampWidth, align: 'center' });
      };

      drawAttractiveStamp(50, yPos, 'LE MANAGER', data.managerName, '#1a5f7a');
      drawAttractiveStamp(50 + stampWidth + spacing, yPos, "L'ADMINISTRATION", data.adminApprovedBy || 'RH OFFICE', '#27ae60');
      drawAttractiveStamp(50 + (stampWidth + spacing) * 2, yPos, 'SÉCURITÉ / GARDE', data.guardConfirmedBy || 'AGENT GARDE', '#2c3e50');

      // --- Footer ---
      const footerY = 760;
      doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor('#eee').lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor('#aaa').font(fontNormal).text(`Ce document est une preuve électronique sécurisée générée par le système RH.`, 50, footerY + 10, { align: 'center' });
      doc.text('© 2026 TewfikSoft - Signature Numérique Certifiée.', { align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

export async function generateEntryAuthPDF(data, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const fontBold = 'Helvetica-Bold';
      const fontNormal = 'Helvetica';

      const companyName = data.companyName || 'ALVER / TEWFIKSOFT';
      
      doc.font(fontBold).fontSize(20).fillColor('#1a5f7a').text(companyName.toUpperCase(), 50, 40, { align: 'center', width: 500 });
      doc.font(fontNormal).fontSize(10).fillColor('#666').text('Gestion des Ressources Humaines - Système Professionnel', 50, 65, { align: 'center', width: 500 });
      
      doc.moveTo(50, 85).lineTo(545, 85).strokeColor('#1a5f7a').lineWidth(2).stroke();

      doc.moveDown(1);
      doc.font(fontBold).fontSize(18).fillColor('#1a5f7a').text("AUTORISATION D'ENTRÉE", { align: 'center' });

      doc.moveDown(1);
      doc.font(fontNormal).fontSize(9).fillColor('#333');
      doc.text(`Référence: ${data.id.toUpperCase()}`, { align: 'right' });
      doc.text(`Généré le: ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, { align: 'right' });

      doc.moveDown(1);
      const startY1 = doc.y;
      doc.rect(50, startY1, 495, 20).fill('#f8fbfc');
      doc.fillColor('#1a5f7a').fontSize(10).font(fontBold).text("DÉTAILS DE L'EMPLOYÉ", 60, startY1 + 5);
      
      doc.moveDown(0.8);
      doc.fillColor('#333').fontSize(11).font(fontNormal);
      doc.text(`Nom et Prénom:`, 60, doc.y, { continued: true }).font(fontBold).text(`  ${data.empName.toUpperCase()}`);

      doc.moveDown(1.5);
      const startY2 = doc.y;
      doc.rect(50, startY2, 495, 20).fill('#f8fbfc');
      doc.fillColor('#1a5f7a').fontSize(10).font(fontBold).text("DÉTAILS DE L'ENTRÉE", 60, startY2 + 5);
      
      doc.moveDown(0.8);
      const officialEntryTime = data.guardConfirmedAt 
        ? new Date(data.guardConfirmedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : data.entryTime;

      doc.fillColor('#333').fontSize(10).font(fontNormal);
      doc.text(`Heure d'Entrée (Réelle): `, 60, doc.y, { continued: true }).font(fontBold).fillColor('#27ae60').text(officialEntryTime);
      doc.fillColor('#333').font(fontNormal).text(`Motif / Raison: `, 60, doc.y + 5, { continued: true }).font(fontBold).text(data.reason);
      doc.font(fontNormal).text(`Date de Demande: `, 60, doc.y + 5, { continued: true }).font(fontBold).text(new Date(data.createdAt).toLocaleString('fr-FR'));

      doc.moveDown(4);
      doc.rect(50, doc.y, 495, 1).fill('#eee');
      doc.moveDown(1);
      doc.fontSize(11).font(fontBold).fillColor('#1a5f7a').text('VALIDATIONS ET SIGNATURES ÉLECTRONIQUES', { align: 'center' });
      doc.moveDown(1.5);

      const yPos = doc.y;
      const stampWidth = 150;
      const spacing = 15;

      const drawAttractiveStamp = (x, y, label, name, color) => {
        doc.roundedRect(x, y, stampWidth, 85, 5).lineWidth(1.5).strokeColor(color).stroke();
        doc.rect(x + 1, y + 1, stampWidth - 2, 16).fill(color);
        doc.fontSize(8).fillColor('#fff').font(fontBold).text(label, x, y + 5, { width: stampWidth, align: 'center' });
        doc.fontSize(7).fillColor('#666').font(fontNormal).text('Signé par:', x + 5, y + 22);
        doc.fontSize(8.5).fillColor(color).font(fontBold).text(name, x + 5, y + 32, { width: stampWidth - 10, align: 'center' });
        doc.fontSize(7).fillColor(color).font('Helvetica-Oblique').text('DOCUMENT VÉRIFIÉ', x, y + 55, { width: stampWidth, align: 'center' });
        doc.fontSize(6).fillColor('#999').font(fontNormal).text(`ID: ${data.id.slice(0,8)} | ${new Date().toLocaleTimeString('fr-FR')}`, x, y + 68, { width: stampWidth, align: 'center' });
      };

      drawAttractiveStamp(50, yPos, 'LE MANAGER', data.managerName, '#1a5f7a');
      drawAttractiveStamp(50 + stampWidth + spacing, yPos, "L'ADMINISTRATION", data.adminApprovedBy || 'RH OFFICE', '#27ae60');
      drawAttractiveStamp(50 + (stampWidth + spacing) * 2, yPos, 'SÉCURITÉ / GARDE', data.guardConfirmedBy || 'AGENT GARDE', '#2c3e50');

      const footerY = 760;
      doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor('#eee').lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor('#aaa').font(fontNormal).text(`Ce document est une preuve électronique sécurisée générée par le système RH.`, 50, footerY + 10, { align: 'center' });
      doc.text('© 2026 TewfikSoft - Signature Numérique Certifiée.', { align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

export async function generateMissionPDF(data, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const fontBold = 'Helvetica-Bold';
      const fontNormal = 'Helvetica';
      const assetsDir = path.join(__dirname, '..', 'assets');
      const logoLeft = fs.existsSync(path.join(assetsDir, 'ALVER.png')) ? path.join(assetsDir, 'ALVER.png') : path.join(assetsDir, 'logo_left.png');
      const logoRight = fs.existsSync(path.join(assetsDir, 'Condor.png')) ? path.join(assetsDir, 'Condor.png') : path.join(assetsDir, 'logo_right.png');

      // --- Header Box (Three compartments) ---
      doc.rect(40, 40, 515, 80).strokeColor('#000').lineWidth(1).stroke();
      doc.moveTo(145, 40).lineTo(145, 120).stroke();
      doc.moveTo(425, 40).lineTo(425, 120).stroke();

      // Left Compartment: Company Branding
      const isFartak = String(data.companyId || '').toLowerCase() === 'vt' || 
                       String(data.companyId || '').toLowerCase() === 'verre_tech' ||
                       String(data.companyName || '').toLowerCase().includes('fartak') ||
                       String(data.companyName || '').toLowerCase().includes('verre tech');
      
      const logoFartak = path.join(assetsDir, 'verre tech.png');

      if (isFartak) {
        if (fs.existsSync(logoFartak)) {
          doc.image(logoFartak, 45, 45, { width: 95, height: 70, fit: [95, 70], align: 'center', valign: 'center' });
        }
      } else if (fs.existsSync(logoLeft)) {
        // ALVER: show ALVER logo on the left
        doc.image(logoLeft, 45, 45, { width: 95, height: 70, fit: [95, 70], align: 'center', valign: 'center' });
      } else {
        // ALVER fallback text if image not found
        doc.font(fontBold).fontSize(16).fillColor('#1b5e20').text('ALVER', 45, 65, { width: 95, align: 'center' });
        doc.fontSize(8).fillColor('#333').text('Spa', 105, 65);
      }
      
      // Center Compartment: Title
      doc.font(fontBold).fontSize(20).fillColor('#1a237e').text('ORDRE DE MISSION', 150, 75, { width: 270, align: 'center' });

      // Right Compartment: Condor logo always (for both companies)
      if (fs.existsSync(logoRight)) {
        doc.image(logoRight, 430, 45, { width: 105, height: 50, fit: [105, 50], align: 'center', valign: 'center' });
        doc.font(fontNormal).fontSize(8).fillColor('#000').text('N° ER.216.R0', 430, 100, { width: 115, align: 'center' });
      } else {
        doc.font(fontBold).fontSize(14).fillColor('#2980b9').text('Condor', 430, 60, { width: 115, align: 'center' });
        doc.font(fontNormal).fontSize(8).fillColor('#000').text('N° ER.216.R0', 430, 85, { width: 115, align: 'center' });
      }

      doc.moveDown(5);

      // --- Body Section ---
      const labelX = 50;
      const valueX = 180;
      const drawField = (label, value, yOffset = 0, isBoldValue = false) => {
        const y = doc.y + yOffset;
        doc.font(fontBold).fontSize(11).fillColor('#000').text(label, labelX, y);
        doc.font(isBoldValue ? fontBold : fontNormal).text(value || '—', valueX, y);
        doc.moveTo(valueX, y + 12).lineTo(530, y + 12).strokeColor('#ccc').lineWidth(0.5).dash(2, { space: 2 }).stroke().undash();
        doc.moveDown(2.2);
      };

      const emp = data.emp || {};
      
      // Réf
      drawField('Réf :', `......../DRH/${new Date().getFullYear()}`, 10);
      
      // Nom & Prénom
      const nameY = doc.y;
      doc.font(fontBold).text('Nom :', labelX, nameY);
      doc.font(fontBold).text(String(emp.lastName_fr || '').toUpperCase(), valueX, nameY);
      doc.text('Prénom :', 350, nameY);
      doc.text(String(emp.firstName_fr || ''), 420, nameY);
      doc.moveTo(valueX, nameY + 12).lineTo(340, nameY + 12).strokeColor('#ccc').lineWidth(0.5).dash(2, { space: 2 }).stroke().undash();
      doc.moveTo(420, nameY + 12).lineTo(530, nameY + 12).stroke();
      doc.moveDown(2.5);

      drawField('Fonction :', String(emp.jobTitle_fr || emp.csp || 'Agent'));
      drawField('Structure :', String(emp.department_fr || emp.direction_fr || 'Direction Générale'));
      drawField('Motifs de la Mission :', data.reason);
      const cleanDestinations = data.destinations.map(d => d.includes(' - ') ? d.split(' - ')[1] : d);
      drawField('Destination :', cleanDestinations.join(' - '), 0, true);
      drawField('Date de départ :', data.startDate);
      drawField('Date de retour :', data.endDate);

      // Improved Transport display
      let transportTxt = data.transport;
      if (transportTxt === 'Service') transportTxt = 'Véhicule de Service';
      else if (transportTxt === 'Personnel') transportTxt = 'Véhicule Personnel';
      else if (transportTxt === 'Autre') transportTxt = 'Autre';

      drawField('Moyen de Transport :', transportTxt);
      
      doc.moveDown(2);

      // --- Date/Location ---
      doc.font(fontBold).fontSize(11).text(`Fait à Es-Sénia ...Le : ${new Date().toLocaleDateString('fr-FR')}`, 330, doc.y);

      // --- Signatures Section Removed as requested ---
      doc.moveDown(10);

      // --- Footer ---
      doc.font(fontNormal).fontSize(8).fillColor('#999').text('Elle ne peut être diffusée en externe sans l’autorisation écrite du Directeur Général', 40, 790, { align: 'center', width: 515 });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

export async function generateReturnAuthPDF(data, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const fontBold = 'Helvetica-Bold';
      const fontNormal = 'Helvetica';

      const companyName = data.companyName || 'ALVER / TEWFIKSOFT';
      
      doc.font(fontBold).fontSize(20).fillColor('#1a5f7a').text(companyName.toUpperCase(), 50, 40, { align: 'center', width: 500 });
      doc.font(fontNormal).fontSize(10).fillColor('#666').text('Gestion des Ressources Humaines - Système Professionnel', 50, 65, { align: 'center', width: 500 });
      
      doc.moveTo(50, 85).lineTo(545, 85).strokeColor('#1a5f7a').lineWidth(2).stroke();

      doc.moveDown(1);
      doc.font(fontBold).fontSize(18).fillColor('#1a5f7a').text('CONFIRMATION DE RETOUR', { align: 'center' });

      doc.moveDown(1);
      doc.font(fontNormal).fontSize(9).fillColor('#333');
      doc.text(`Référence: ${data.id.toUpperCase()}`, { align: 'right' });
      doc.text(`Généré le: ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, { align: 'right' });

      doc.moveDown(1);
      const startY1 = doc.y;
      doc.rect(50, startY1, 495, 20).fill('#f8fbfc');
      doc.fillColor('#1a5f7a').fontSize(10).font(fontBold).text("DÉTAILS DE L'EMPLOYÉ", 60, startY1 + 5);
      
      doc.moveDown(0.8);
      doc.fillColor('#333').fontSize(11).font(fontNormal);
      doc.text(`Nom et Prénom:`, 60, doc.y, { continued: true }).font(fontBold).text(`  ${data.empName.toUpperCase()}`);

      doc.moveDown(1.5);
      const startY2 = doc.y;
      doc.rect(50, startY2, 495, 20).fill('#f8fbfc');
      doc.fillColor('#1a5f7a').fontSize(10).font(fontBold).text('DÉTAILS DU RETOUR', 60, startY2 + 5);
      
      doc.moveDown(0.8);
      const officialReturnTime = data.returnedAt 
        ? new Date(data.returnedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : '—';

      let duration = data.actualDuration;
      if (!duration && data.guardConfirmedAt && data.returnedAt) {
        const start = new Date(data.guardConfirmedAt);
        const end = new Date(data.returnedAt);
        const diffMs = end - start;
        const diffHrs = Math.floor(diffMs / 3600000);
        const diffMins = Math.floor((diffMs % 3600000) / 60000);
        duration = `${diffHrs}h ${diffMins}m`;
      }

      doc.fillColor('#333').fontSize(10).font(fontNormal);
      doc.text(`Heure de Sortie: `, 60, doc.y, { continued: true }).font(fontBold).text(new Date(data.guardConfirmedAt).toLocaleTimeString('fr-FR'));
      doc.font(fontNormal).text(`Heure de Retour: `, 60, doc.y + 5, { continued: true }).font(fontBold).fillColor('#27ae60').text(officialReturnTime);
      doc.fillColor('#333').font(fontNormal).text(`Durée Totale: `, 60, doc.y + 5, { continued: true }).font(fontBold).fillColor('#d9534f').text(duration || '—');
      doc.fillColor('#333').font(fontNormal).text(`Motif / Raison: `, 60, doc.y + 5, { continued: true }).font(fontBold).text(data.reason || '—');

      doc.moveDown(4);
      doc.rect(50, doc.y, 495, 1).fill('#eee');
      doc.moveDown(1);
      doc.fontSize(11).font(fontBold).fillColor('#1a5f7a').text('VALIDATIONS ET SIGNATURES ÉLECTRONIQUES', { align: 'center' });
      doc.moveDown(1.5);

      const yPos = doc.y;
      const stampWidth = 150;
      const spacing = 15;

      const drawAttractiveStamp = (x, y, label, name, color) => {
        doc.roundedRect(x, y, stampWidth, 85, 5).lineWidth(1.5).strokeColor(color).stroke();
        doc.rect(x + 1, y + 1, stampWidth - 2, 16).fill(color);
        doc.fontSize(8).fillColor('#fff').font(fontBold).text(label, x, y + 5, { width: stampWidth, align: 'center' });
        doc.fontSize(7).fillColor('#666').font(fontNormal).text('Signé par:', x + 5, y + 22);
        doc.fontSize(8.5).fillColor(color).font(fontBold).text(name, x + 5, y + 32, { width: stampWidth - 10, align: 'center' });
        doc.fontSize(7).fillColor(color).font('Helvetica-Oblique').text('DOCUMENT VÉRIFIÉ', x, y + 55, { width: stampWidth, align: 'center' });
        doc.fontSize(6).fillColor('#999').font(fontNormal).text(`ID: ${data.id.slice(0,8)} | ${new Date().toLocaleTimeString('fr-FR')}`, x, y + 68, { width: stampWidth, align: 'center' });
      };

      drawAttractiveStamp(50, yPos, 'LE MANAGER', data.managerName, '#1a5f7a');
      drawAttractiveStamp(50 + stampWidth + spacing, yPos, "L'ADMINISTRATION", data.adminApprovedBy || 'RH OFFICE', '#27ae60');
      drawAttractiveStamp(50 + (stampWidth + spacing) * 2, yPos, 'SÉCURITÉ / GARDE', data.returnConfirmedBy || 'AGENT GARDE', '#2c3e50');

      const footerY = 760;
      doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor('#eee').lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor('#aaa').font(fontNormal).text(`Ce document est une preuve électronique sécurisée générée par le système RH.`, 50, footerY + 10, { align: 'center' });
      doc.text('© 2026 TewfikSoft - Signature Numérique Certifiée.', { align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

export async function generateWorkCertPDF(data, outputPath) {
  return new Promise(async (resolve, reject) => {
    const tempQrPath = path.join(path.dirname(outputPath), `qr_${data.id}.png`);
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const fontBold = 'Helvetica-Bold';
      const fontNormal = 'Helvetica';
      const fontOblique = 'Helvetica-Oblique';
      
      const assetsDir = path.join(__dirname, '..', 'assets');
      const logoLeft = fs.existsSync(path.join(assetsDir, 'ALVER.png')) ? path.join(assetsDir, 'ALVER.png') : path.join(assetsDir, 'logo_left.png');
      const logoRight = fs.existsSync(path.join(assetsDir, 'Condor.png')) ? path.join(assetsDir, 'Condor.png') : path.join(assetsDir, 'logo_right.png');

      const isFartak = String(data.companyId || '').toLowerCase() === 'vt' || 
                       String(data.companyId || '').toLowerCase() === 'verre_tech' ||
                       String(data.companyName || '').toLowerCase().includes('fartak') ||
                       String(data.companyName || '').toLowerCase().includes('verre tech');

      const logoFartak = path.join(assetsDir, 'verre tech.png');

      // --- Header Box (Three compartments) ---
      doc.rect(40, 40, 515, 80).strokeColor('#000').lineWidth(1).stroke();
      doc.moveTo(145, 40).lineTo(145, 120).stroke();
      doc.moveTo(425, 40).lineTo(425, 120).stroke();

      // Left Compartment
      if (isFartak && fs.existsSync(logoFartak)) {
        doc.image(logoFartak, 45, 45, { width: 95, height: 70, fit: [95, 70], align: 'center', valign: 'center' });
      } else if (!isFartak && fs.existsSync(logoLeft)) {
        doc.image(logoLeft, 45, 45, { width: 95, height: 70, fit: [95, 70], align: 'center', valign: 'center' });
      }

      // Center Compartment: Text Block
      doc.fillColor('#000');
      
      const capitalText = isFartak ? 'SOCIÉTÉ PAR ACTIONS' : 'SOCIÉTÉ PAR ACTIONS AU CAPITAL SOCIAL DE 6.606.000.000 DA';
      const companyTitle = isFartak ? 'VERRE TECH SPA' : 'ALVER SPA';
      const addressText = isFartak ? 'Zone Industrielle, Oran' : 'Avenue des Martyrs de la Révolution, Es-Sénia, Oran';
      
      doc.font(fontBold).fontSize(6).text(capitalText, 150, 48, { width: 270, align: 'center' });
      doc.font(fontBold).fontSize(14).fillColor('#0f7b50').text(companyTitle, 150, 58, { width: 270, align: 'center' });
      
      // Draw underline under central title
      doc.font(fontBold).fontSize(9).fillColor('#000').text('Direction des Ressources Humaines', 150, 76, { width: 270, align: 'center' });
      const drhWidth = doc.widthOfString('Direction des Ressources Humaines');
      doc.moveTo(285 - drhWidth / 2, 86).lineTo(285 + drhWidth / 2, 86).strokeColor('#000').lineWidth(0.8).stroke();
      
      doc.font(fontNormal).fontSize(7.5).fillColor('#333').text(addressText, 150, 92, { width: 270, align: 'center' });
      
      if (!isFartak) {
        doc.font(fontNormal).fontSize(7).fillColor('#333').text('Tél: 041 51 11 11 / 041 51 11 15', 150, 104, { width: 270, align: 'center' });
        doc.font(fontBold).fontSize(7).fillColor('#0f7b50').text('Web: https://www.alver.dz', 150, 113, { width: 270, align: 'center' });
      }

      // Right Compartment: Condor logo always
      if (fs.existsSync(logoRight)) {
        doc.image(logoRight, 430, 45, { width: 105, height: 50, fit: [105, 50], align: 'center', valign: 'center' });
        doc.font(fontNormal).fontSize(7).fillColor('#000').text('N° ER.216.RO', 430, 100, { width: 115, align: 'center' });
      } else {
        doc.font(fontBold).fontSize(14).fillColor('#2980b9').text('Condor', 430, 60, { width: 115, align: 'center' });
        doc.font(fontNormal).fontSize(7).fillColor('#000').text('N° ER.216.RO', 430, 85, { width: 115, align: 'center' });
      }

      // --- Banner ---
      doc.roundedRect(40, 140, 515, 30, 4).fillAndStroke('#f4fbf7', '#0f7b50');
      doc.font(fontBold).fontSize(16).fillColor('#0f7b50').text('ATTESTATION DE TRAVAIL', 40, 148, { align: 'center', width: 515 });

      // --- Body ---
      const companyLabel = isFartak ? 'Verre Tech Spa' : 'ALVER Spa';
      const addressLabel = isFartak ? 'Zone Industrielle, Oran' : 'Avenue des Martyrs de la Révolution, Es-Sénia, Oran';
      
      doc.fillColor('#000');
      doc.font(fontOblique).fontSize(11).text(`Nous soussignés, La société ${companyLabel}, sise à : ${addressLabel}.`, 50, 195, { width: 495 });

      const emp = data.emp || {};
      const genderTitle = emp.gender === 'F' ? 'Madame' : 'Monsieur';
      
      const attY = 230;
      doc.font(fontBold).fontSize(11).fillColor('#000').text('Attestons par la présente que :', 50, attY);
      const attWidth = doc.widthOfString('Attestons par la présente que :');
      doc.fillColor('#e53e3e').text(` ${genderTitle}`, 50 + attWidth + 5, attY);
      const genderWidth = doc.widthOfString(` ${genderTitle}`);
      doc.moveTo(50 + attWidth + 5 + genderWidth + 5, attY + 10).lineTo(530, attY + 10).strokeColor('#ccc').lineWidth(0.5).dash(1, { space: 1.5 }).stroke().undash();

      // Custom French Date Formatter Helper
      const formatDateFr = (dateStr) => {
        if (!dateStr) return '—';
        try {
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) return dateStr;
          const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
          return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
        } catch (e) {
          return dateStr;
        }
      };

      // Draw rows
      let y = 260;
      const drawCertField = (label, value, isRed = false) => {
        doc.font(fontBold).fontSize(11).fillColor('#000').text(label, 50, y);
        doc.text(':', 180, y);
        doc.font(fontBold).fillColor(isRed ? '#e53e3e' : '#000').text(value || '—', 200, y);
        doc.moveTo(200, y + 10).lineTo(530, y + 10).strokeColor('#ccc').lineWidth(0.5).dash(1, { space: 1.5 }).stroke().undash();
        y += 30;
      };

      drawCertField('Nom', String(emp.lastName_fr || '').toUpperCase());
      drawCertField('Prénom', String(emp.firstName_fr || ''));
      drawCertField('En sa qualité de', String(emp.jobTitle_fr || ''));
      drawCertField('Né(e) le', formatDateFr(emp.birthDate));
      drawCertField('N° Sécurité Sociale', String(emp.socialNumber || '—'));
      drawCertField('Nature du contrat', String(emp.contractType || '—'));

      // Est employé(e)...
      doc.font(fontBold).fontSize(11).fillColor('#000').text('Est employé(e) au sein de notre organisme depuis le :', 50, y);
      const estLabelWidth = doc.widthOfString('Est employé(e) au sein de notre organisme depuis le :');
      doc.moveTo(50, y + 10).lineTo(50 + estLabelWidth, y + 10).strokeColor('#000').lineWidth(0.8).stroke();
      
      const valX = 50 + estLabelWidth + 5;
      doc.font(fontBold).text(`${formatDateFr(emp.startDate)} ... à ce jour`, valX, y);
      const valWidth = doc.widthOfString(`${formatDateFr(emp.startDate)} ... à ce jour`);
      doc.moveTo(valX + valWidth + 5, y + 10).lineTo(530, y + 10).strokeColor('#ccc').lineWidth(0.5).dash(1, { space: 1.5 }).stroke().undash();
      
      y += 30;

      // Motif
      doc.font(fontBold).fontSize(11).fillColor('#000').text('Motif de la demande', 50, y);
      doc.text(':', 180, y);
      doc.font(fontBold).fillColor('#e53e3e').text(data.reason || 'Dossier Administratif', 200, y);
      doc.moveTo(200, y + 10).lineTo(530, y + 10).strokeColor('#ccc').lineWidth(0.5).dash(1, { space: 1.5 }).stroke().undash();

      // Download and Embed Verification QR Code
      try {
        const qrText = `ATTESTATION DE TRAVAIL\nSociété: ${companyLabel}\nNom: ${emp.lastName_fr}\nPrénom: ${emp.firstName_fr}\nQualité: ${emp.jobTitle_fr}\nMatricule: ${emp.clockingId}\nContrat: ${emp.contractType}\nMotif: ${data.reason}\nID: ${data.id}`;
        await downloadQRCode(qrText, tempQrPath);
        if (fs.existsSync(tempQrPath)) {
          doc.image(tempQrPath, 50, 670, { width: 85, height: 85 });
        }
      } catch (qrErr) {
        // Fallback: draw placeholder rectangle if download fails
        doc.rect(50, 670, 85, 85).strokeColor('#ccc').stroke();
        doc.fontSize(8).text('QR CODE', 55, 710);
      }

      // Date Stamp
      doc.font(fontBold).fontSize(11).fillColor('#000').text(`Fait à Es-Sénia, le : ${formatDateFr(new Date())}`, 330, 730);

      doc.end();
      stream.on('finish', () => {
        if (fs.existsSync(tempQrPath)) fs.unlinkSync(tempQrPath);
        resolve(outputPath);
      });
      stream.on('error', (err) => {
        if (fs.existsSync(tempQrPath)) fs.unlinkSync(tempQrPath);
        reject(err);
      });

    } catch (e) {
      if (fs.existsSync(tempQrPath)) fs.unlinkSync(tempQrPath);
      reject(e);
    }
  });
}

export async function generateBonVentePDF(data, outputPath) {
  return new Promise(async (resolve, reject) => {
    const tempQrPath = path.join(path.dirname(outputPath), `qr_${data.id}.png`);
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 20 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const fontBold = 'Helvetica-Bold';
      const fontNormal = 'Helvetica';
      const assetsDir = path.join(__dirname, '..', 'assets');
      const logoLeft = fs.existsSync(path.join(assetsDir, 'ALVER.png')) ? path.join(assetsDir, 'ALVER.png') : path.join(assetsDir, 'logo_left.png');


      // --- 1. Draw Talon Slip on the Left ---
      // Left box: X: 20 to 110 pt. Width = 90 pt.
      doc.rect(20, 20, 90, 555).strokeColor('#000').lineWidth(1.5).stroke();
      
      doc.font(fontBold).fontSize(10).fillColor('#1a5f7a').text('ALVER SPA', 25, 30, { align: 'center', width: 80 });
      doc.font(fontNormal).fontSize(8).fillColor('#666').text('2026', 25, 42, { align: 'center', width: 80 });
      
      let talonY = 60;
      const drawTalonField = (label, val) => {
        doc.font(fontBold).fontSize(7).fillColor('#000').text(label, 25, talonY);
        doc.font(fontNormal).fontSize(6.5).fillColor('#333').text(val || '—', 25, talonY + 9, { width: 80 });
        talonY = doc.y + 4;
        doc.moveTo(25, talonY).lineTo(105, talonY).strokeColor('#ccc').lineWidth(0.5).stroke();
        talonY += 6;
      };
      
      // Full BVA ID with year: BVA_XXXX / YYYY
      const bvaYear = data.createdAt ? new Date(data.createdAt).getFullYear() : new Date().getFullYear();
      let seqStr = '001';
      try {
        const db2 = loadDB();
        const bvasThisYear = (db2.bon_vente || []).filter(b => new Date(b.createdAt || Date.now()).getFullYear() === bvaYear);
        const idx = bvasThisYear.findIndex(b => b.id === data.id);
        if (idx !== -1) {
          seqStr = (idx + 1).toString().padStart(3, '0');
        } else {
          seqStr = (bvasThisYear.length + 1).toString().padStart(3, '0');
        }
      } catch (e) {
        console.error("Error getting sequence number", e);
      }
      const bvaIdFull = `BVA ${seqStr}/${bvaYear}`;
      drawTalonField('N° :', bvaIdFull);
      drawTalonField('DATE :', data.createdAt ? new Date(data.createdAt).toLocaleDateString('fr-FR') : '—');
      drawTalonField('CLIENT :', data.clientName);
      
      // Combined PRODUIT + CODE + QTÉ list (one article per line)
      const articlesLines = (data.articles || []).map((a, i) => `${(i + 1).toString().padStart(2, '0')}- ${a.prod}`).join('\n');
      drawTalonField('PRODUITS :', articlesLines);
      
      const codesLines = (data.articles || []).map(a => `${a.code} (${a.qty})`).join('\n');
      drawTalonField('CODES & QTE :', codesLines);
      
      const talonTotalQty = (data.articles || []).reduce((acc, cur) => acc + parseInt(cur.qty || 0), 0).toString();
      drawTalonField('QTÉ TOTALE :', talonTotalQty);
      
      drawTalonField('N° FACTURE :', data.factureNum);
      
      doc.font(fontBold).fontSize(7).text('MODE DE PAIEMENT :', 25, talonY);
      talonY += 12;
      const talonDrawCheck = (label, isChecked) => {
        doc.rect(25, talonY, 7, 7).strokeColor('#000').lineWidth(0.8).stroke();
        if (isChecked) {
          doc.moveTo(25, talonY).lineTo(32, talonY + 7).stroke();
          doc.moveTo(32, talonY).lineTo(25, talonY + 7).stroke();
        }
        doc.font(fontNormal).fontSize(6.5).text(label, 36, talonY + 1);
        talonY += 10;
      };
      
      const rawPayMeth = String(data.paymentMethod || '').toLowerCase();
      const payMeth = rawPayMeth.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      talonDrawCheck('VIREMENT', payMeth.includes('vire'));
      talonDrawCheck('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'));
      talonDrawCheck('CHEQUE', payMeth.includes('cheq'));
      talonDrawCheck('ESPECE', payMeth.includes('esp') || payMeth.includes('cash'));

      // --- QR CODE AT BOTTOM OF TALON ---
      try {
        const dateStr = data.createdAt ? new Date(data.createdAt).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');
        const articlesTxt = (data.articles || []).map(a => `${a.code}:${a.qty}`).join(',');
        const qrText = `BVA:${bvaIdFull.replace('BVA ','')}\nDate:${dateStr}\nClient:${data.clientName}\nFacture:${data.factureNum || '-'}\nMontant:${data.amount || '-'} DA\nArticles:${articlesTxt}`;
        await downloadQRCode(qrText, tempQrPath);
        if (fs.existsSync(tempQrPath)) {
          doc.image(tempQrPath, 30, 485, { width: 70, height: 70 });
        }
      } catch (qrErr) {
        doc.rect(30, 485, 70, 70).strokeColor('#ccc').stroke();
        doc.fontSize(8).fillColor('#333').text('QR CODE', 35, 515);
      }

      // --- 2. Draw Torn Dotted Line ---
      doc.moveTo(115, 20).lineTo(115, 575).dash(3, { space: 3 }).strokeColor('#999').lineWidth(1).stroke().undash();

      // --- 3. Draw Main Header Box ---
      // Width = 695 pt (X: 125 to 820). Height = 45 pt (Y: 20 to 65).
      doc.rect(125, 20, 695, 45).strokeColor('#000').lineWidth(1.5).stroke();
      
      // ALVER Spa Logo / branding
      if (fs.existsSync(logoLeft)) {
        doc.image(logoLeft, 130, 25, { width: 50, height: 35, fit: [50, 35], align: 'center', valign: 'center' });
      } else {
        doc.font(fontBold).fontSize(14).fillColor('#1b5e20').text('ALVER', 135, 26, { continued: true });
        doc.font(fontNormal).fontSize(8).fillColor('#333').text(' Spa');
        doc.font(fontNormal).fontSize(6.5).fillColor('#666').text('Production Verre Emballage', 135, 43);
      }

      // Title Center
      doc.font(fontBold).fontSize(13).fillColor('#1a5f7a').text('BON DE VENTE PRODUIT FINI', 125, 25, { align: 'center', width: 695 });
      doc.font(fontBold).fontSize(10).fillColor('#000').text('AUTORISATION DE SORTIE', 125, 42, { align: 'center', width: 695 });

      // N° / Year Right
      const dateStr = data.createdAt ? new Date(data.createdAt).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');
      doc.font(fontBold).fontSize(9).fillColor('#000').text(`N° :  ${bvaIdFull.replace('N°', '')}`, 690, 26, { align: 'right', width: 120 });
      doc.font(fontNormal).fontSize(8).fillColor('#666').text(`Date :  ${dateStr}`, 690, 42, { align: 'right', width: 120 });

      // --- 4. Draw The 5 Vertically Stacked Sections ---
      const startX = 125;
      const totalWidth = 695;
      const sectionHeight = 95;
      const gap = 5;

      const drawSectionHeader = (y, text) => {
        doc.rect(startX, y, totalWidth, 14).fill('#b4c6e7');
        doc.font(fontBold).fontSize(8).fillColor('#000').text(text, startX, y + 3, { align: 'center', width: totalWidth });
      };

      const drawStamp = (x, y, title, name, color) => {
        const formalColor = '#1a5f7a';
        const stampW = 108;
        const stampH = 68;
        const cx = x - 2; // stamp left edge

        // === OUTER BORDER ===
        // Removed as per request to keep it inside the box without an outer frame

        // === TOP ROW: lock icon | text | green check ===
        // Lock circle
        doc.circle(cx + 12, y + 16, 9).lineWidth(1.5).strokeColor(formalColor).stroke();
        doc.rect(cx + 9, y + 15, 6, 5).fillAndStroke(formalColor, formalColor);
        doc.moveTo(cx + 10, y + 15)
           .lineTo(cx + 10, y + 12)
           .bezierCurveTo(cx+10, y+9.5, cx+14, y+9.5, cx+14, y+12)
           .lineTo(cx + 14, y + 15)
           .lineWidth(1).strokeColor(formalColor).stroke();

        // Center text block
        doc.font(fontBold).fontSize(5.5).fillColor(formalColor)
           .text('DOCUMENT SIGNÉ', cx + 24, y + 7, { width: 56, align: 'center' });
        doc.text('ÉLECTRONIQUEMENT', cx + 24, y + 13.5, { width: 56, align: 'center' });
        doc.font(fontNormal).fontSize(3.8).fillColor('#555')
           .text('Conformément à la loi 18-07', cx + 24, y + 22, { width: 56, align: 'center' });

        // Green check circle
        doc.circle(cx + 93, y + 16, 9).fill('#27ae60');
        doc.moveTo(cx + 89.5, y + 16)
           .lineTo(cx + 92, y + 19.5)
           .lineTo(cx + 97.5, y + 11.5)
           .lineWidth(1.8).strokeColor('#fff').stroke();

        // === SEPARATOR LINE ===
        doc.moveTo(cx, y + 33).lineTo(cx + stampW, y + 33)
           .lineWidth(0.6).strokeColor('#aaa').stroke();

        if (name) {
          // Role label - directly below separator, no inner box
          doc.font(fontNormal).fontSize(4.2).fillColor('#555')
             .text(`Signé par: ${title.toUpperCase()}`, cx, y + 36, { width: stampW, align: 'center' });

          // Full Name bold and centered
          doc.font(fontBold).fontSize(7).fillColor(formalColor)
             .text(name.toUpperCase(), cx, y + 44, { width: stampW, align: 'center' });

          // Date line
          doc.font(fontNormal).fontSize(4).fillColor('#888')
             .text(`Date: ${dateStr}`, cx, y + 57, { width: stampW, align: 'center' });
        } else {
          doc.font(fontBold).fontSize(7).fillColor('#e74c3c')
             .text('EN ATTENTE DE SIGNATURE', cx, y + 45, { width: stampW, align: 'center' });
        }
      };
      
      const drawGridH = (x1, x2, y_val) => {
        doc.moveTo(x1, y_val).lineTo(x2, y_val).strokeColor('#000').lineWidth(0.8).stroke();
      };
      const drawGridV = (x_val, y1, y2) => {
        doc.moveTo(x_val, y1).lineTo(x_val, y2).strokeColor('#000').lineWidth(0.8).stroke();
      };

      const drawTable = (x, y, articles) => {
        const rowCount = Math.max(3, Math.min(6, articles.length));
        const rowHeight = 10;
        const headerHeight = 11;
        const totalHeight = headerHeight + (rowCount * rowHeight);
        
        // Headers
        doc.rect(x, y, 220, headerHeight).fill('#d9e1f2');
        doc.font(fontBold).fontSize(6.5).fillColor('#000');
        doc.text('CODE', x + 5, y + 3);
        doc.text('PRODUIT', x + 55, y + 3);
        doc.text('QUANTITÉ', x + 175, y + 3);
        
        // Grid
        doc.rect(x, y, 220, totalHeight).strokeColor('#000').lineWidth(0.8).stroke();
        doc.moveTo(x + 50, y).lineTo(x + 50, y + totalHeight).strokeColor('#000').stroke();
        doc.moveTo(x + 170, y).lineTo(x + 170, y + totalHeight).strokeColor('#000').stroke();
        
        // Rows
        doc.font(fontNormal).fontSize(6.5);
        let rowY = y + headerHeight;
        for (let i = 0; i < rowCount; i++) {
          const art = articles[i];
          if (art) {
            doc.text(art.code || '—', x + 5, rowY + 2);
            doc.text(art.prod || '—', x + 55, rowY + 2, { width: 110, height: 9 });
            doc.font(fontBold).text(art.qty || '—', x + 175, rowY + 2);
            doc.font(fontNormal);
          }
          rowY += rowHeight;
          if (i < rowCount - 1) doc.moveTo(x, rowY).lineTo(x + 220, rowY).strokeColor('#000').lineWidth(0.5).stroke();
        }
      };

      // ── SECTION 1: SERVICE VENTE ──────────────────────────────────────────
      let y = 70;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'SERVICE VENTE');
      
      // Fields inside Sales Section
      let insideY = y + 14;
      
      // Vertical line separating labels and values
      drawGridV(startX + 55, insideY, y + sectionHeight);
      
      // Horizontal lines
      drawGridH(startX, startX + 170, insideY + 22);
      drawGridH(startX, startX + 170, insideY + 44);

      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('CLIENT :', startX + 5, insideY + 8);
      doc.font(fontNormal).fontSize(6.5).text(data.clientName || '—', startX + 60, insideY + 8, { width: 105, height: 20 });

      doc.font(fontBold).text('BC N° :', startX + 5, insideY + 30);
      doc.font(fontNormal).text(data.bcNum || '—', startX + 60, insideY + 30);

      doc.font(fontBold).text('DATE :', startX + 5, insideY + 52);
      doc.font(fontNormal).text(data.commercialDate || dateStr, startX + 60, insideY + 52);

      // Vertical separators
      doc.moveTo(startX + 170, insideY).lineTo(startX + 170, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      
      // Article Table inside Sales
      drawTable(startX + 180, insideY + 6, data.articles || []);

      doc.moveTo(startX + 410, insideY).lineTo(startX + 410, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      // Mode of Payment & Transport grids
      drawGridH(startX + 410, startX + 580, insideY + 16);
      drawGridV(startX + 495, insideY, y + sectionHeight);
      drawGridH(startX + 410, startX + 495, insideY + 32); // check box separator
      drawGridH(startX + 410, startX + 495, insideY + 48); // check box separator
      drawGridH(startX + 410, startX + 495, insideY + 64); // check box separator

      let payX = startX + 415;
      doc.font(fontBold).fontSize(7).text('MODE DE PAIEMENT :', payX, insideY + 6);
      
      const drawCheckbox = (label, isChecked, x, cy) => {
        doc.rect(x, cy, 7, 7).strokeColor('#000').lineWidth(0.8).stroke();
        if (isChecked) {
          doc.moveTo(x, cy).lineTo(x + 7, cy + 7).strokeColor('#000').stroke();
          doc.moveTo(x + 7, cy).lineTo(x, cy + 7).strokeColor('#000').stroke();
        }
        doc.font(fontNormal).fontSize(6.5).text(label, x + 11, cy + 1);
      };

      drawCheckbox('VIREMENT', payMeth.includes('vire'), payX, insideY + 20);
      drawCheckbox('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), payX, insideY + 36);
      drawCheckbox('CHÈQUE', payMeth.includes('cheq'), payX, insideY + 52);
      drawCheckbox('ESPÈCE', payMeth.includes('esp') || payMeth.includes('cash'), payX, insideY + 68);
      
      let transX = startX + 500;
      doc.font(fontBold).fontSize(7).text('TRANSPORT :', transX, insideY + 6);
      const isAlverTrans = String(data.transportType || '').toLowerCase() === 'alver';
      drawCheckbox('ALVER (SI RENDU)', isAlverTrans, transX, insideY + 22);
      drawCheckbox('CLIENT', !isAlverTrans, transX, insideY + 44);

      doc.moveTo(startX + 580, insideY).lineTo(startX + 580, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      // Visa & stamp
      doc.font(fontBold).fontSize(7).text('VISA ET CACHET :', startX + 590, insideY + 6);
      drawStamp(startX + 590, insideY + 16, 'Le Commercial', data.commercialName, '#2b5797');


      // ── SECTION 2: SERVICE EXPEDITION ───────────────────────────────────────
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'SERVICE EXPEDITION');
      
      insideY = y + 14;
      
      drawGridV(startX + 105, insideY, y + sectionHeight);
      drawGridH(startX, startX + 170, insideY + 22);
      drawGridH(startX, startX + 170, insideY + 44);

      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('N° BON DE LIVRAISON :', startX + 5, insideY + 8);
      doc.font(fontNormal).text(data.blNum || '—', startX + 110, insideY + 8);

      doc.font(fontBold).text('TRANSPORTEUR :', startX + 5, insideY + 30);
      doc.font(fontNormal).text(data.transporter || '—', startX + 110, insideY + 30);

      doc.font(fontBold).text('DATE :', startX + 5, insideY + 52);
      doc.font(fontBold).fillColor('#e53e3e').text(data.shippingDate || dateStr, startX + 110, insideY + 52);
      doc.fillColor('#000');

      doc.moveTo(startX + 170, insideY).lineTo(startX + 170, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      // Table (shipped products)
      drawTable(startX + 180, insideY + 6, data.articles || []);

      doc.moveTo(startX + 410, insideY).lineTo(startX + 410, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      // Logistics fields
      drawGridH(startX + 410, startX + 580, insideY + 22);
      drawGridH(startX + 410, startX + 580, insideY + 44);
      drawGridV(startX + 510, insideY, y + sectionHeight);

      let logX = startX + 415;
      doc.font(fontBold).fontSize(6.5).text('CHAUFFEUR :', logX, insideY + 8);
      doc.font(fontNormal).fontSize(7.5).text(data.driverName || '—', logX + 100, insideY + 8);

      doc.font(fontBold).fontSize(6.5).text('MATRICULE DE CAMION :', logX, insideY + 30);
      doc.font(fontNormal).fontSize(7.5).text(data.vehiclePlate || '—', logX + 100, insideY + 30);

      doc.font(fontBold).fontSize(6.5).text('N° PERMIS DE CONDUITE :', logX, insideY + 52);
      doc.font(fontNormal).fontSize(7.5).text(data.pcNum || '—', logX + 100, insideY + 52);

      doc.moveTo(startX + 580, insideY).lineTo(startX + 580, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      doc.font(fontBold).fontSize(7).text('VISA ET CACHET :', startX + 590, insideY + 6);
      drawStamp(startX + 590, insideY + 16, 'Expédition GDS', data.gdsName, '#e3a21a');


      const formatAmount = (amt) => {
        if (!amt) return '—';
        const num = parseFloat(String(amt).replace(/[^\d.-]/g, ''));
        if (isNaN(num)) return amt;
        return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };

      // ── SECTION 3: SERVICE FACTURATION ──────────────────────────────────────
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'SERVICE FACTURATION');
      
      insideY = y + 14;
      
      drawGridV(startX + 105, insideY, y + sectionHeight);
      drawGridH(startX, startX + 250, insideY + 35);
      
      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('N° FACTURE PRODUIT :', startX + 5, insideY + 15);
      doc.font(fontNormal).text(data.factureNum || '—', startX + 110, insideY + 15);

      doc.font(fontBold).fontSize(8.5).text('MONTANT :', startX + 5, insideY + 50);
      doc.font(fontBold).fillColor('#e53e3e').text(data.amount ? `${formatAmount(data.amount)} DA` : '—', startX + 110, insideY + 50);
      doc.fillColor('#000');

      doc.moveTo(startX + 250, insideY).lineTo(startX + 250, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      // Checkboxes grid
      drawGridH(startX + 250, startX + 580, insideY + 16);
      drawGridH(startX + 250, startX + 580, insideY + 40);
      drawGridV(startX + 415, insideY, y + sectionHeight);

      payX = startX + 260;
      doc.font(fontBold).fontSize(7.5).text('MODE DE PAIEMENT :', payX, insideY + 6);
      
      drawCheckbox('VIREMENT', payMeth.includes('vire'), payX + 10, insideY + 22);
      drawCheckbox('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), payX + 10, insideY + 48);
      drawCheckbox('CHÈQUE', payMeth.includes('cheq'), payX + 175, insideY + 22);
      drawCheckbox('ESPÈCE', payMeth.includes('esp') || payMeth.includes('cash'), payX + 175, insideY + 48);

      doc.moveTo(startX + 580, insideY).lineTo(startX + 580, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      doc.font(fontBold).fontSize(7).text('VISA ET CACHET :', startX + 590, insideY + 6);
      drawStamp(startX + 590, insideY + 16, 'Facturation', data.financeName, '#00a300');


      // ── SECTION 4: SERVICE COMPTABILITE ─────────────────────────────────────
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'SERVICE COMPTABILITE');
      
      insideY = y + 14;
      
      drawGridV(startX + 105, insideY, y + sectionHeight);
      drawGridH(startX, startX + 250, insideY + 22);
      drawGridH(startX, startX + 250, insideY + 44);

      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('CLIENT :', startX + 5, insideY + 8);
      doc.font(fontNormal).fontSize(6.5).text(data.clientName || '—', startX + 110, insideY + 8, { width: 135, height: 20 });

      doc.font(fontBold).text('N° FACTURE PRODUIT :', startX + 5, insideY + 30);
      doc.font(fontNormal).text(data.factureNum || '—', startX + 110, insideY + 30);

      doc.font(fontBold).fontSize(8.5).text('MONTANT :', startX + 5, insideY + 52);
      doc.font(fontBold).fillColor('#e53e3e').text(data.amount ? `${formatAmount(data.amount)} DA` : '—', startX + 110, insideY + 52);
      doc.fillColor('#000');

      doc.moveTo(startX + 250, insideY).lineTo(startX + 250, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      // Checkboxes grid
      drawGridH(startX + 250, startX + 580, insideY + 16);
      drawGridH(startX + 250, startX + 580, insideY + 40);
      drawGridV(startX + 415, insideY, y + sectionHeight);

      payX = startX + 260;
      doc.font(fontBold).fontSize(7.5).text('MODE DE PAIEMENT :', payX, insideY + 6);
      
      drawCheckbox('VIREMENT', payMeth.includes('vire'), payX + 10, insideY + 22);
      drawCheckbox('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), payX + 10, insideY + 48);
      drawCheckbox('CHÈQUE', payMeth.includes('cheq'), payX + 175, insideY + 22);
      drawCheckbox('ESPÈCE', payMeth.includes('esp') || payMeth.includes('cash'), payX + 175, insideY + 48);

      doc.moveTo(startX + 580, insideY).lineTo(startX + 580, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      doc.font(fontBold).fontSize(7).text('VISA ET CACHET :', startX + 590, insideY + 6);
      drawStamp(startX + 590, insideY + 16, 'Comptabilité', data.financeName, '#00a300');


      // ── SECTION 5: POSTE DE GARDE ───────────────────────────────────────────
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'POSTE DE GARDE');
      
      insideY = y + 14;
      
      drawGridV(startX + 105, insideY, y + sectionHeight);
      drawGridH(startX, startX + 220, insideY + 22);
      drawGridH(startX, startX + 220, insideY + 44);

      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('N° BON DE LIVRAISON :', startX + 5, insideY + 8);
      doc.font(fontNormal).text(data.blNum || '—', startX + 110, insideY + 8);

      doc.font(fontBold).text('CHAUFFEUR :', startX + 5, insideY + 30);
      doc.font(fontNormal).text(data.driverName || '—', startX + 110, insideY + 30);

      doc.font(fontBold).fontSize(6.5).text('MATRICULE DE CAMION :', startX + 5, insideY + 52);
      doc.font(fontNormal).fontSize(7.5).text(data.vehiclePlate || '—', startX + 110, insideY + 52);

      doc.moveTo(startX + 220, insideY).lineTo(startX + 220, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      // Gate metrics
      drawGridH(startX + 220, startX + 410, insideY + 22);
      drawGridH(startX + 220, startX + 410, insideY + 44);
      drawGridV(startX + 310, insideY, y + sectionHeight);

      let gateX = startX + 225;
      doc.font(fontBold).text("HEURE D'ENTRÉE :", gateX, insideY + 8);
      doc.font(fontNormal).text(data.entryTime || '—', gateX + 90, insideY + 8);

      doc.font(fontBold).text("HEURE DE SORTIE :", gateX, insideY + 30);
      doc.font(fontNormal).text(data.exitTime || '—', gateX + 90, insideY + 30);

      doc.font(fontBold).text("EQUIPE :", gateX, insideY + 52);
      doc.font(fontBold).fillColor('#e53e3e').text(data.guardShift || '—', gateX + 90, insideY + 52);
      doc.fillColor('#000');

      doc.moveTo(startX + 410, insideY).lineTo(startX + 410, y + sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();

      // Quantity sum & gate signatures
      let quantX = startX + 420;
      const totalQty = (data.articles || []).reduce((acc, cur) => acc + parseInt(cur.qty || 0), 0);
      doc.font(fontBold).fontSize(8.5).text('QUANTITÉ TOTALE :', quantX, insideY + 12);
      doc.font(fontBold).fillColor('#1b5e20').fontSize(10).text(`${totalQty} unités`, quantX + 10, insideY + 25);
      doc.fillColor('#000');

      doc.font(fontBold).fontSize(7.5).text('VISA CHAUFFEUR :', quantX, insideY + 42);
      doc.font('Helvetica-Oblique').fontSize(6).text('Lu et Approuvé', quantX + 10, insideY + 52);

      doc.moveTo(startX + 580, insideY).lineTo(startX + 580, y + sectionHeight).stroke();

      doc.font(fontBold).fontSize(7).text('VISA ET CACHET :', startX + 590, insideY + 6);
      drawStamp(startX + 590, insideY + 16, 'Poste de Garde', data.guardName, '#2c3e50');

      // --- Footer Security line (must be on page 1, before y=595) ---
      doc.font('Helvetica-Oblique').fontSize(6).fillColor('#888').text(`Document électronique sécurisé ALVER Spa - Réf: -${seqStr}/${bvaYear}`, startX, 565, { align: 'center', width: totalWidth });

      doc.end();
      stream.on('finish', () => {
        if (fs.existsSync(tempQrPath)) fs.unlinkSync(tempQrPath);
        resolve(outputPath);
      });
      stream.on('error', (err) => {
        if (fs.existsSync(tempQrPath)) fs.unlinkSync(tempQrPath);
        reject(err);
      });
    } catch (e) {
      if (fs.existsSync(tempQrPath)) fs.unlinkSync(tempQrPath);
      reject(e);
    }
  });
}
