import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import arabicReshaper from 'arabic-reshaper';
import bidiFactory from 'bidi-js';
import https from 'https';

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
                       String(data.companyName || '').toLowerCase().includes('fartak') ||
                       String(data.companyName || '').toLowerCase().includes('verre tech');
      
      if (isFartak) {
        // Verre Tech: left compartment stays EMPTY (no logo, no text)
        // Just leave the box blank
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
                       String(data.companyName || '').toLowerCase().includes('fartak') ||
                       String(data.companyName || '').toLowerCase().includes('verre tech');

      // --- Header Box (Three compartments) ---
      doc.rect(40, 40, 515, 80).strokeColor('#000').lineWidth(1).stroke();
      doc.moveTo(145, 40).lineTo(145, 120).stroke();
      doc.moveTo(425, 40).lineTo(425, 120).stroke();

      // Left Compartment: ALVER logo ONLY if NOT Fartak/Verre Tech
      if (!isFartak && fs.existsSync(logoLeft)) {
        doc.image(logoLeft, 45, 45, { width: 95, height: 70, fit: [95, 70], align: 'center', valign: 'center' });
      }

      // Center Compartment: Text Block
      doc.fillColor('#000');
      doc.font(fontBold).fontSize(6).text('SOCIÉTÉ PAR ACTIONS AU CAPITAL SOCIAL DE 6.606.000.000 DA', 150, 48, { width: 270, align: 'center' });
      doc.font(fontBold).fontSize(14).fillColor('#0f7b50').text('ALVER SPA', 150, 58, { width: 270, align: 'center' });
      
      // Draw underline under central title
      doc.font(fontBold).fontSize(9).fillColor('#000').text('Direction des Ressources Humaines', 150, 76, { width: 270, align: 'center' });
      const drhWidth = doc.widthOfString('Direction des Ressources Humaines');
      doc.moveTo(285 - drhWidth / 2, 86).lineTo(285 + drhWidth / 2, 86).strokeColor('#000').lineWidth(0.8).stroke();
      
      doc.font(fontNormal).fontSize(7.5).fillColor('#333').text('Avenue des Martyrs de la Révolution, Es-Sénia, Oran', 150, 92, { width: 270, align: 'center' });
      
      doc.font(fontNormal).fontSize(7).fillColor('#333').text('Tél: 041 51 11 11 / 041 51 11 15', 150, 104, { width: 270, align: 'center' });
      doc.font(fontBold).fontSize(7).fillColor('#0f7b50').text('Web: https://www.alver.dz', 150, 113, { width: 270, align: 'center' });

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
export async function generateBonVentePDF(data, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 20 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const fontBold = 'Helvetica-Bold';
      const fontNormal = 'Helvetica';

      // --- 1. Draw Talon Slip on the Left ---
      // Left box: X: 20 to 110 pt. Width = 90 pt.
      doc.rect(20, 20, 90, 555).strokeColor('#000').lineWidth(1.5).stroke();
      
      doc.font(fontBold).fontSize(10).fillColor('#1a5f7a').text('ALVER SPA', 25, 30, { align: 'center', width: 80 });
      doc.font(fontNormal).fontSize(8).fillColor('#666').text('2026', 25, 42, { align: 'center', width: 80 });
      
      const talonYStart = 60;
      const drawTalonField = (label, val, y) => {
        doc.font(fontBold).fontSize(7).fillColor('#000').text(label, 25, y);
        doc.font(fontNormal).fontSize(7.5).fillColor('#333').text(val || '—', 25, y + 9, { width: 80, height: 18 });
        doc.moveTo(25, y + 25).lineTo(105, y + 25).strokeColor('#ccc').lineWidth(0.5).stroke();
      };
      
      drawTalonField('N° :', data.id ? data.id.toUpperCase().slice(0, 8) : '—', talonYStart);
      drawTalonField('DATE :', data.createdAt ? new Date(data.createdAt).toLocaleDateString('fr-FR') : '—', talonYStart + 30);
      drawTalonField('CLIENT :', data.clientName, talonYStart + 60);
      
      // Summarize the products in a small text field
      const articlesSummary = (data.articles || []).map(a => `${a.prod} (${a.qty})`).join(', ');
      drawTalonField('PRODUIT :', articlesSummary, talonYStart + 110);
      drawTalonField('CODE :', (data.articles || []).map(a => a.code).join(', '), talonYStart + 160);
      drawTalonField('QUANTITE :', (data.articles || []).reduce((acc, cur) => acc + parseInt(cur.qty || 0), 0).toString(), talonYStart + 210);
      drawTalonField('N° FACTURE :', data.factureNum, talonYStart + 260);
      
      // Mode de paiement checkboxes in talon
      doc.font(fontBold).fontSize(7).text('MODE DE PAIEMENT :', 25, talonYStart + 310);
      const talonDrawCheck = (label, isChecked, y) => {
        doc.rect(25, y, 7, 7).strokeColor('#000').lineWidth(0.8).stroke();
        if (isChecked) {
          doc.moveTo(25, y).lineTo(32, y + 7).stroke();
          doc.moveTo(32, y).lineTo(25, y + 7).stroke();
        }
        doc.font(fontNormal).fontSize(6.5).text(label, 36, y + 1);
      };
      
      const payMeth = String(data.paymentMethod || '').toLowerCase();
      talonDrawCheck('VIREMENT', payMeth.includes('vire'), talonYStart + 322);
      talonDrawCheck('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), talonYStart + 332);
      talonDrawCheck('CHEQUE', payMeth.includes('cheq'), talonYStart + 342);
      talonDrawCheck('ESPECE', payMeth.includes('esp') || payMeth.includes('cash'), talonYStart + 352);

      // --- 2. Draw Torn Dotted Line ---
      doc.moveTo(115, 20).lineTo(115, 575).dash(3, { space: 3 }).strokeColor('#999').lineWidth(1).stroke().undash();

      // --- 3. Draw Main Header Box ---
      // Width = 695 pt (X: 125 to 820). Height = 45 pt (Y: 20 to 65).
      doc.rect(125, 20, 695, 45).strokeColor('#000').lineWidth(1.5).stroke();
      
      // ALVER Spa Logo text / branding
      doc.font(fontBold).fontSize(14).fillColor('#1b5e20').text('ALVER', 135, 26, { continued: true });
      doc.font(fontNormal).fontSize(8).fillColor('#333').text(' Spa');
      doc.font(fontNormal).fontSize(6.5).fillColor('#666').text('Production Verre Emballage', 135, 43);

      // Title Center
      doc.font(fontBold).fontSize(13).fillColor('#1a5f7a').text('BON DE VENTE PRODUIT FINI', 125, 25, { align: 'center', width: 695 });
      doc.font(fontBold).fontSize(10).fillColor('#000').text('AUTORISATION DE SORTIE', 125, 42, { align: 'center', width: 695 });

      // N° / Year Right
      const dateStr = data.createdAt ? new Date(data.createdAt).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');
      doc.font(fontBold).fontSize(9).fillColor('#000').text(`N° :  ${data.id ? data.id.toUpperCase().slice(0, 8) : '—'} / 2026`, 690, 26, { align: 'right', width: 120 });
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
        if (!name) return;
        doc.roundedRect(x, y, 110, 50, 4).lineWidth(1.2).strokeColor(color).stroke();
        doc.rect(x + 1, y + 1, 108, 12).fill(color);
        doc.font(fontBold).fontSize(6.5).fillColor('#fff').text(title.toUpperCase(), x, y + 4, { width: 110, align: 'center' });
        
        doc.font(fontNormal).fontSize(6).fillColor('#555').text('Signé électroniquement:', x + 5, y + 16);
        doc.font(fontBold).fontSize(7.5).fillColor(color).text(name, x, y + 25, { width: 110, align: 'center' });
        doc.font('Helvetica-Oblique').fontSize(5).fillColor(color).text('DOCUMENT VALIDÉ', x, y + 38, { width: 110, align: 'center' });
      };

      const drawTable = (x, y, articles) => {
        // Headers
        doc.rect(x, y, 220, 11).fill('#d9e1f2');
        doc.font(fontBold).fontSize(6.5).fillColor('#000');
        doc.text('CODE', x + 5, y + 3);
        doc.text('PRODUIT', x + 55, y + 3);
        doc.text('QUANTITÉ', x + 175, y + 3);
        
        // Grid
        doc.rect(x, y, 220, 53).strokeColor('#000').lineWidth(0.5).stroke();
        doc.moveTo(x + 50, y).lineTo(x + 50, y + 53).stroke();
        doc.moveTo(x + 170, y).lineTo(x + 170, y + 53).stroke();
        
        // Rows
        doc.font(fontNormal).fontSize(6.5);
        let rowY = y + 11;
        for (let i = 0; i < 3; i++) {
          const art = articles[i];
          if (art) {
            doc.text(art.code || '—', x + 5, rowY + 3);
            doc.text(art.prod || '—', x + 55, rowY + 3, { width: 110, height: 9 });
            doc.font(fontBold).text(art.qty || '—', x + 175, rowY + 3);
            doc.font(fontNormal);
          }
          rowY += 14;
          if (i < 2) doc.moveTo(x, rowY).lineTo(x + 220, rowY).stroke();
        }
      };

      // ── SECTION 1: SERVICE VENTE ──────────────────────────────────────────
      let y = 70;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'SERVICE VENTE');
      
      // Fields inside Sales Section
      let insideY = y + 14;
      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('CLIENT :', startX + 10, insideY + 10);
      doc.font(fontNormal).text(data.clientName || '—', startX + 60, insideY + 10);

      doc.font(fontBold).text('BC N° :', startX + 10, insideY + 30);
      doc.font(fontNormal).text(data.bcNum || '—', startX + 60, insideY + 30);

      doc.font(fontBold).text('DATE :', startX + 10, insideY + 50);
      doc.font(fontNormal).text(data.commercialDate || dateStr, startX + 60, insideY + 50);

      // Vertical separators
      doc.moveTo(startX + 170, insideY).lineTo(startX + 170, y + sectionHeight).strokeColor('#000').lineWidth(1).stroke();
      
      // Article Table inside Sales
      drawTable(startX + 180, insideY + 6, data.articles || []);

      doc.moveTo(startX + 410, insideY).lineTo(startX + 410, y + sectionHeight).stroke();

      // Mode of Payment & Transport
      let payX = startX + 420;
      doc.font(fontBold).fontSize(7).text('MODE DE PAIEMENT :', payX, insideY + 6);
      
      const drawCheckbox = (label, isChecked, x, cy) => {
        doc.rect(x, cy, 7, 7).strokeColor('#000').lineWidth(0.8).stroke();
        if (isChecked) {
          doc.moveTo(x, cy).lineTo(x + 7, cy + 7).stroke();
          doc.moveTo(x + 7, cy).lineTo(x, cy + 7).stroke();
        }
        doc.font(fontNormal).fontSize(6.5).text(label, x + 11, cy + 1);
      };

      drawCheckbox('VIREMENT', payMeth.includes('vire'), payX, insideY + 18);
      drawCheckbox('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), payX, insideY + 28);
      drawCheckbox('CHEQUE', payMeth.includes('cheq'), payX, insideY + 38);
      drawCheckbox('ESPECE', payMeth.includes('esp') || payMeth.includes('cash'), payX, insideY + 48);

      let transX = payX + 80;
      doc.font(fontBold).fontSize(7).text('TRANSPORT :', transX, insideY + 6);
      const isAlverTrans = String(data.transportType || '').toLowerCase() === 'alver';
      drawCheckbox('ALVER (SI RENDU)', isAlverTrans, transX, insideY + 18);
      drawCheckbox('CLIENT', !isAlverTrans, transX, insideY + 28);

      doc.moveTo(startX + 580, insideY).lineTo(startX + 580, y + sectionHeight).stroke();

      // Visa & stamp
      doc.font(fontBold).fontSize(7).text('VISA ET CACHET :', startX + 590, insideY + 6);
      drawStamp(startX + 590, insideY + 16, 'Le Commercial', data.commercialName, '#2b5797');


      // ── SECTION 2: SERVICE EXPEDITION ───────────────────────────────────────
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'SERVICE EXPEDITION');
      
      insideY = y + 14;
      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('N° BON DE LIVRAISON :', startX + 10, insideY + 10);
      doc.font(fontNormal).text(data.blNum || '—', startX + 120, insideY + 10);

      doc.font(fontBold).text('TRANSPORTEUR :', startX + 10, insideY + 30);
      doc.font(fontNormal).text(data.transporter || '—', startX + 100, insideY + 30);

      doc.font(fontBold).text('DATE :', startX + 10, insideY + 50);
      doc.font(fontNormal).text(data.shippingDate || dateStr, startX + 60, insideY + 50);

      doc.moveTo(startX + 170, insideY).lineTo(startX + 170, y + sectionHeight).stroke();

      // Table (shipped products)
      drawTable(startX + 180, insideY + 6, data.articles || []);

      doc.moveTo(startX + 410, insideY).lineTo(startX + 410, y + sectionHeight).stroke();

      // Logistics fields
      let logX = startX + 420;
      doc.font(fontBold).fontSize(7.5).text('CHAUFFEUR :', logX, insideY + 10);
      doc.font(fontNormal).text(data.driverName || '—', logX + 70, insideY + 10);

      doc.font(fontBold).text('MATRICULE :', logX, insideY + 28);
      doc.font(fontNormal).text(data.vehiclePlate || '—', logX + 70, insideY + 28);

      doc.font(fontBold).text('N° PC :', logX, insideY + 46);
      doc.font(fontNormal).text(data.pcNum || '—', logX + 50, insideY + 46);

      doc.moveTo(startX + 580, insideY).lineTo(startX + 580, y + sectionHeight).stroke();

      doc.font(fontBold).fontSize(7).text('VISA ET CACHET :', startX + 590, insideY + 6);
      drawStamp(startX + 590, insideY + 16, 'Expédition GDS', data.gdsName, '#e3a21a');


      // ── SECTION 3: SERVICE FACTURATION ──────────────────────────────────────
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'SERVICE FACTURATION');
      
      insideY = y + 14;
      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('N° FACTURE PRODUIT :', startX + 10, insideY + 15);
      doc.font(fontNormal).text(data.factureNum || '—', startX + 120, insideY + 15);

      doc.font(fontBold).fontSize(8.5).text('MONTANT :', startX + 10, insideY + 40);
      doc.font(fontBold).fillColor('#e53e3e').text(data.amount ? `${data.amount} DA` : '—', startX + 70, insideY + 40);
      doc.fillColor('#000');

      doc.moveTo(startX + 250, insideY).lineTo(startX + 250, y + sectionHeight).stroke();

      // Checkboxes
      payX = startX + 270;
      doc.font(fontBold).fontSize(7.5).text('MODE DE PAIEMENT :', payX, insideY + 10);
      drawCheckbox('VIREMENT', payMeth.includes('vire'), payX + 10, insideY + 25);
      drawCheckbox('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), payX + 10, insideY + 45);
      drawCheckbox('CHÈQUE', payMeth.includes('cheq'), payX + 120, insideY + 25);
      drawCheckbox('ESPÈCE', payMeth.includes('esp') || payMeth.includes('cash'), payX + 120, insideY + 45);

      doc.moveTo(startX + 580, insideY).lineTo(startX + 580, y + sectionHeight).stroke();

      doc.font(fontBold).fontSize(7).text('VISA ET CACHET :', startX + 590, insideY + 6);
      drawStamp(startX + 590, insideY + 16, 'Facturation', data.financeName, '#00a300');


      // ── SECTION 4: SERVICE COMPTABILITE ─────────────────────────────────────
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'SERVICE COMPTABILITE');
      
      insideY = y + 14;
      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('CLIENT :', startX + 10, insideY + 10);
      doc.font(fontNormal).text(data.clientName || '—', startX + 60, insideY + 10);

      doc.font(fontBold).text('N° FACTURE PRODUIT :', startX + 10, insideY + 28);
      doc.font(fontNormal).text(data.factureNum || '—', startX + 120, insideY + 28);

      doc.font(fontBold).fontSize(8.5).text('MONTANT :', startX + 10, insideY + 46);
      doc.font(fontBold).fillColor('#e53e3e').text(data.amount ? `${data.amount} DA` : '—', startX + 70, insideY + 46);
      doc.fillColor('#000');

      doc.moveTo(startX + 250, insideY).lineTo(startX + 250, y + sectionHeight).stroke();

      // Checkboxes
      payX = startX + 270;
      doc.font(fontBold).fontSize(7.5).text('MODE DE PAIEMENT :', payX, insideY + 10);
      drawCheckbox('VIREMENT', payMeth.includes('vire'), payX + 10, insideY + 25);
      drawCheckbox('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), payX + 10, insideY + 45);
      drawCheckbox('CHÈQUE', payMeth.includes('cheq'), payX + 120, insideY + 25);
      drawCheckbox('ESPÈCE', payMeth.includes('esp') || payMeth.includes('cash'), payX + 120, insideY + 45);

      doc.moveTo(startX + 580, insideY).lineTo(startX + 580, y + sectionHeight).stroke();

      doc.font(fontBold).fontSize(7).text('VISA ET CACHET :', startX + 590, insideY + 6);
      drawStamp(startX + 590, insideY + 16, 'Comptabilité', data.financeName, '#00a300');


      // ── SECTION 5: POSTE DE GARDE ───────────────────────────────────────────
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.2).stroke();
      drawSectionHeader(y, 'POSTE DE GARDE');
      
      insideY = y + 14;
      doc.font(fontBold).fontSize(7.5).fillColor('#000');
      doc.text('N° BON DE LIVRAISON :', startX + 10, insideY + 10);
      doc.font(fontNormal).text(data.blNum || '—', startX + 120, insideY + 10);

      doc.font(fontBold).text('CHAUFFEUR :', startX + 10, insideY + 28);
      doc.font(fontNormal).text(data.driverName || '—', startX + 80, insideY + 28);

      doc.font(fontBold).text('MATRICULE :', startX + 10, insideY + 46);
      doc.font(fontNormal).text(data.vehiclePlate || '—', startX + 80, insideY + 46);

      doc.moveTo(startX + 220, insideY).lineTo(startX + 220, y + sectionHeight).stroke();

      // Gate metrics
      let gateX = startX + 230;
      doc.font(fontBold).text("HEURE D'ENTRÉE :", gateX, insideY + 10);
      doc.font(fontNormal).text(data.entryTime || '—', gateX + 90, insideY + 10);

      doc.font(fontBold).text("HEURE DE SORTIE :", gateX, insideY + 28);
      doc.font(fontNormal).text(data.exitTime || '—', gateX + 90, insideY + 28);

      doc.font(fontBold).text("EQUIPE :", gateX, insideY + 46);
      doc.font(fontNormal).text(data.guardShift || '—', gateX + 50, insideY + 46);

      doc.moveTo(startX + 410, insideY).lineTo(startX + 410, y + sectionHeight).stroke();

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

      // --- Footer Security line ---
      doc.font('Helvetica-Oblique').fontSize(6).fillColor('#888').text(`Document électronique sécurisé ALVER Spa - Réf: BVA-${(data.id || '').toUpperCase().slice(0, 8)}`, startX, 580, { align: 'center', width: totalWidth });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}
