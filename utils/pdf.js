import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import arabicReshaper from 'arabic-reshaper';
import bidiFactory from 'bidi-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bidi = bidiFactory();

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
                       String(data.companyName || '').toLowerCase().includes('fartak');
      
      if (fs.existsSync(logoLeft) && !isFartak) {
        doc.image(logoLeft, 45, 45, { width: 95, height: 70, fit: [95, 70], align: 'center', valign: 'center' });
      } else if (!isFartak) {
        // ALVER Style Fallback (only if not Fartak)
        doc.font(fontBold).fontSize(16).fillColor('#1b5e20').text('ALVER', 45, 65, { width: 95, align: 'center' });
        doc.fontSize(8).fillColor('#333').text('Spa', 105, 65);
      } else {
        // Fartak Branding (No left logo)
        doc.font(fontBold).fontSize(14).fillColor('#c0392b').text('VERRE TECH', 45, 65, { width: 95, align: 'center' });
        doc.fontSize(10).fillColor('#2c3e50').text('FARTAK', 45, 85, { width: 95, align: 'center' });
      }
      
      // Center Compartment: Title
      doc.font(fontBold).fontSize(20).fillColor('#1a237e').text('ORDRE DE MISSION', 150, 75, { width: 270, align: 'center' });

      // Right Compartment: Secondary Logo/Reference
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
      drawField('Destination :', cleanDestinations.join(', '), 0, true);
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
