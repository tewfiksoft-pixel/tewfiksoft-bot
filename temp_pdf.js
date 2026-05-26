export async function generateBonVentePDF(data, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 20 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const fontBold = 'Helvetica-Bold';
      const fontNormal = 'Helvetica';

      // --- 1. Draw Talon Slip on the Left ---
      // Left box: X: 20 to 120 pt. Width = 100 pt. Height = 555 (20 to 575)
      doc.rect(20, 20, 100, 555).strokeColor('#000').lineWidth(1.5).stroke();
      
      doc.font(fontBold).fontSize(10).fillColor('#000').text('ALVER SPA', 20, 30, { align: 'center', width: 100 });
      doc.font(fontNormal).fontSize(8).fillColor('#000').text('2026', 20, 45, { align: 'center', width: 100 });
      
      const talonYStart = 70;
      const drawTalonField = (label, val, y) => {
        doc.font(fontBold).fontSize(7).fillColor('#000').text(label, 25, y);
        doc.font(fontNormal).fontSize(7.5).fillColor('#333').text(val || '', 25, y + 10, { width: 90, height: 18 });
      };
      
      drawTalonField('N° :', data.id ? data.id.toUpperCase().slice(0, 8) : '', talonYStart);
      drawTalonField('DATE :', data.createdAt ? new Date(data.createdAt).toLocaleDateString('fr-FR') : '', talonYStart + 35);
      drawTalonField('CLIENT :', data.clientName, talonYStart + 70);
      
      const articlesSummary = (data.articles || []).map(a => `${a.prod} (${a.qty})`).join(', ');
      drawTalonField('PRODUIT :', articlesSummary, talonYStart + 115);
      drawTalonField('CODE :', (data.articles || []).map(a => a.code).join(', '), talonYStart + 175);
      drawTalonField('QUANTITE :', (data.articles || []).reduce((acc, cur) => acc + parseInt(cur.qty || 0), 0).toString(), talonYStart + 225);
      drawTalonField('N° FACTURE :', data.factureNum, talonYStart + 265);
      
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
      talonDrawCheck('VIREMENT', payMeth.includes('vire'), talonYStart + 325);
      talonDrawCheck('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), talonYStart + 338);
      talonDrawCheck('CHEQUE', payMeth.includes('cheq'), talonYStart + 351);
      talonDrawCheck('ESPECE', payMeth.includes('esp') || payMeth.includes('cash'), talonYStart + 364);

      // --- 3. Draw Main Header Box ---
      const startX = 135;
      const totalWidth = 685;
      doc.rect(startX, 20, totalWidth, 45).strokeColor('#000').lineWidth(1.5).stroke();
      
      // ALVER Spa text
      doc.font(fontBold).fontSize(16).fillColor('#1b5e20').text('ALVER', startX + 10, 26, { continued: true });
      doc.font(fontNormal).fontSize(10).fillColor('#333').text(' Spa');

      doc.font(fontBold).fontSize(12).fillColor('#000').text('BON DE VENTE PRODUIT FINI', startX, 26, { align: 'center', width: totalWidth });
      doc.font(fontBold).fontSize(10).text('AUTORISATION DE SORTIE', startX, 42, { align: 'center', width: totalWidth });

      const dateStr = data.createdAt ? new Date(data.createdAt).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');
      doc.font(fontBold).fontSize(9).text(`N° :       / 2026`, startX + totalWidth - 150, 26, { align: 'right', width: 140 });
      // Insert ID dynamically inside the N° gap
      doc.font(fontNormal).text((data.id || '').toUpperCase().slice(0, 8), startX + totalWidth - 65, 26);

      // --- 4. SECTIONS SETUP ---
      const sectionHeight = 95;
      const gap = 6;
      let y = 70;

      const drawSectionHeader = (y, text) => {
        doc.rect(startX, y, totalWidth, 14).fill('#b4c6e7').strokeColor('#000').lineWidth(1.5).stroke();
        doc.font(fontBold).fontSize(8).fillColor('#000').text(text, startX, y + 3, { align: 'center', width: totalWidth });
      };

      const drawStamp = (x, y, title, name, color) => {
        if (!name) return;
        doc.roundedRect(x, y, 110, 45, 4).lineWidth(1.2).strokeColor(color).stroke();
        doc.rect(x + 1, y + 1, 108, 12).fill(color);
        doc.font(fontBold).fontSize(6.5).fillColor('#fff').text(title.toUpperCase(), x, y + 4, { width: 110, align: 'center' });
        doc.font(fontNormal).fontSize(6).fillColor('#555').text('Signé électroniquement:', x + 5, y + 15);
        doc.font(fontBold).fontSize(7.5).fillColor(color).text(name, x, y + 23, { width: 110, align: 'center' });
        doc.font('Helvetica-Oblique').fontSize(5).fillColor(color).text('DOCUMENT VALIDÉ', x, y + 34, { width: 110, align: 'center' });
      };

      const drawTable = (x, y, w, h, articles) => {
        doc.rect(x, y, w, h).strokeColor('#000').lineWidth(1.5).stroke();
        doc.rect(x, y, w, 18).fill('#d9e1f2').stroke();
        doc.moveTo(x, y + 9).lineTo(x + w - 55, y + 9).stroke(); 
        
        doc.font(fontBold).fontSize(7).fillColor('#000');
        doc.text('Article', x, y + 2, { width: w - 55, align: 'center' });
        doc.text('CODE', x, y + 11, { width: 55, align: 'center' });
        doc.text('PRODUIT', x + 55, y + 11, { width: w - 110, align: 'center' });
        doc.text('QUANTITE', x + w - 55, y + 6, { width: 55, align: 'center' }); 
        
        doc.moveTo(x + 55, y + 9).lineTo(x + 55, y + h).stroke();
        doc.moveTo(x + w - 55, y).lineTo(x + w - 55, y + h).stroke();
        
        let rowY = y + 18;
        const rowH = (h - 18) / 3;
        for (let i = 0; i < 3; i++) {
          if (i > 0) doc.moveTo(x, rowY).lineTo(x + w, rowY).lineWidth(1).stroke();
          const art = articles[i];
          if (art) {
            doc.font(fontNormal).text(art.code || '', x + 2, rowY + 3, { width: 51, align: 'center' });
            doc.text(art.prod || '', x + 57, rowY + 3, { width: w - 114, height: rowH - 4 });
            doc.font(fontBold).text(art.qty || '', x + w - 53, rowY + 3, { width: 51, align: 'center' });
          }
          rowY += rowH;
        }
      };

      const drawCheckbox = (label, isChecked, x, cy) => {
        doc.rect(x, cy, 8, 8).strokeColor('#000').lineWidth(1).stroke();
        if (isChecked) {
          doc.moveTo(x, cy).lineTo(x + 8, cy + 8).stroke();
          doc.moveTo(x + 8, cy).lineTo(x, cy + 8).stroke();
        }
        doc.font(fontNormal).fontSize(7).text(label, x - doc.widthOfString(label) - 5, cy + 1.5);
      };

      // -- SECTION 1: SERVICE VENTE ------------------------------------------
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.5).stroke();
      drawSectionHeader(y, 'SERVICE VENTE');
      
      let insideY = y + 14;
      doc.rect(startX, insideY, totalWidth, 18).stroke();
      doc.moveTo(startX + 280, insideY).lineTo(startX + 280, insideY + 18).stroke();
      doc.moveTo(startX + 450, insideY).lineTo(startX + 450, insideY + 18).stroke();
      
      doc.font(fontNormal).fontSize(7);
      doc.text('CLIENT:', startX + 5, insideY + 5);
      doc.font(fontBold).text(data.clientName || '', startX + 45, insideY + 5);

      doc.font(fontNormal).text('BC N°:', startX + 285, insideY + 5);
      doc.font(fontBold).text(data.bcNum || '', startX + 320, insideY + 5);

      doc.font(fontNormal).text('DATE:', startX + 455, insideY + 5);
      doc.font(fontBold).text(data.commercialDate || dateStr, startX + 485, insideY + 5);

      insideY += 18; 
      drawTable(startX, insideY, 280, sectionHeight - 32, data.articles || []);
      doc.moveTo(startX + 550, insideY).lineTo(startX + 550, y + sectionHeight).stroke();
      
      // Payment & Transport
      doc.font(fontNormal).fontSize(7).text('MODE DE PAIEMENT:', startX + 350, insideY + 4, { align: 'center', width: 200 });
      drawCheckbox('VIREMENT', payMeth.includes('vire'), startX + 340, insideY + 16);
      drawCheckbox('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), startX + 410, insideY + 16);
      drawCheckbox('CHEQUE', payMeth.includes('cheq'), startX + 340, insideY + 30);
      drawCheckbox('ESPECE', payMeth.includes('esp') || payMeth.includes('cash'), startX + 410, insideY + 30);
      
      doc.moveTo(startX + 280, insideY + 42).lineTo(startX + 550, insideY + 42).stroke();
      doc.font(fontNormal).text('TRANSPORT:', startX + 285, insideY + 46);
      const isAlverTrans = String(data.transportType || '').toLowerCase() === 'alver';
      drawCheckbox('ALVER (SI RENDU):', isAlverTrans, startX + 440, insideY + 46);
      drawCheckbox('CLIENT:', !isAlverTrans, startX + 510, insideY + 46);

      doc.font(fontNormal).text('VISA ET CACHET:', startX + 555, insideY + 4);
      drawStamp(startX + 560, insideY + 14, 'LE COMMERCIAL', data.commercialName, '#2b5797');

      // -- SECTION 2: SERVICE EXPEDITION ---------------------------------------
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight).strokeColor('#000').lineWidth(1.5).stroke();
      drawSectionHeader(y, 'SERVICE EXPEDITION');
      
      insideY = y + 14;
      doc.rect(startX, insideY, totalWidth, 18).stroke();
      doc.moveTo(startX + 280, insideY).lineTo(startX + 280, insideY + 18).stroke();
      doc.moveTo(startX + 550, insideY).lineTo(startX + 550, insideY + 18).stroke();
      
      doc.font(fontNormal).fontSize(7);
      doc.text('N° BON DE LIVRAISON:', startX + 5, insideY + 5);
      doc.font(fontBold).text(data.blNum || '', startX + 110, insideY + 5);

      doc.font(fontNormal).text('TRANSPORTEUR:', startX + 285, insideY + 2);
      doc.font(fontNormal).fontSize(6).text('(SI RENDU):', startX + 285, insideY + 10);
      doc.font(fontBold).fontSize(7).text(data.transporter || '', startX + 350, insideY + 5);

      doc.font(fontNormal).text('DATE:', startX + 555, insideY + 5);
      doc.font(fontBold).text(data.shippingDate || dateStr, startX + 585, insideY + 5);

      insideY += 18;
      drawTable(startX, insideY, 280, sectionHeight - 32, data.articles || []);
      doc.moveTo(startX + 550, insideY).lineTo(startX + 550, y + sectionHeight).stroke();
      
      doc.font(fontNormal).fontSize(7);
      doc.text('CHAUFFEUR:', startX + 285, insideY + 8);
      doc.font(fontBold).text(data.driverName || '', startX + 350, insideY + 8);
      doc.moveTo(startX + 280, insideY + 20).lineTo(startX + 550, insideY + 20).stroke();
      
      doc.font(fontNormal).text('MATRICULE:', startX + 285, insideY + 28);
      doc.font(fontBold).text(data.vehiclePlate || '', startX + 350, insideY + 28);
      doc.moveTo(startX + 280, insideY + 41).lineTo(startX + 550, insideY + 41).stroke();
      
      doc.font(fontNormal).text('N° PC:', startX + 285, insideY + 49);
      doc.font(fontBold).text(data.pcNum || '', startX + 320, insideY + 49);
      
      doc.font(fontNormal).text('VISA ET CACHET:', startX + 555, insideY + 4);
      drawStamp(startX + 560, insideY + 14, 'EXPÉDITION GDS', data.gdsName, '#e3a21a');

      // -- SECTION 3: SERVICE FACTURATION --------------------------------------
      y += sectionHeight + gap;
      doc.rect(startX, y, totalWidth, sectionHeight - 30).strokeColor('#000').lineWidth(1.5).stroke();
      drawSectionHeader(y, 'SERVICE FACTURATION');
      
      insideY = y + 14;
      doc.moveTo(startX + 280, insideY).lineTo(startX + 280, y + sectionHeight - 30).stroke();
      doc.moveTo(startX + 550, insideY).lineTo(startX + 550, y + sectionHeight - 30).stroke();
      
      doc.font(fontNormal).text('N° FACTURE PRODUIT:', startX + 5, insideY + 8);
      doc.font(fontBold).text(data.factureNum || '', startX + 110, insideY + 8);
      doc.moveTo(startX, insideY + 25).lineTo(startX + 280, insideY + 25).stroke();
      
      doc.font(fontNormal).text('MONTANT:', startX + 5, insideY + 35);
      doc.font(fontBold).text(data.amount ? `${data.amount} DA` : '', startX + 60, insideY + 35);

      doc.font(fontNormal).text('MODE DE PAIEMENT:', startX + 350, insideY + 4, { align: 'center', width: 200 });
      drawCheckbox('VIREMENT', payMeth.includes('vire'), startX + 340, insideY + 16);
      drawCheckbox('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), startX + 410, insideY + 16);
      drawCheckbox('CHEQUE', payMeth.includes('cheq'), startX + 340, insideY + 32);
      drawCheckbox('ESPECE', payMeth.includes('esp') || payMeth.includes('cash'), startX + 410, insideY + 32);
      
      doc.font(fontNormal).text('DATE:', startX + 555, insideY + 4);
      doc.font(fontBold).text(data.financeDate || dateStr, startX + 585, insideY + 4);
      doc.moveTo(startX + 550, insideY + 14).lineTo(startX + totalWidth, insideY + 14).stroke();
      
      doc.font(fontNormal).text('VISA ET CACHET:', startX + 555, insideY + 16);
      drawStamp(startX + 560, insideY + 24, 'FACTURATION', data.financeName, '#00a300');

      // -- SECTION 4: SERVICE COMPTABILITE -------------------------------------
      y += sectionHeight - 30 + gap;
      doc.rect(startX, y, totalWidth, sectionHeight - 15).strokeColor('#000').lineWidth(1.5).stroke();
      drawSectionHeader(y, 'SERVICE COMPTABILITE');
      
      insideY = y + 14;
      doc.rect(startX, insideY, totalWidth, 18).stroke();
      doc.moveTo(startX + 280, insideY).lineTo(startX + 280, y + sectionHeight - 15).stroke();
      doc.moveTo(startX + 550, insideY).lineTo(startX + 550, y + sectionHeight - 15).stroke();
      
      doc.font(fontNormal).text('CLIENT:', startX + 5, insideY + 5);
      doc.font(fontBold).text(data.clientName || '', startX + 45, insideY + 5);

      insideY += 18;
      doc.font(fontNormal).text('N° FACTURE PRODUIT:', startX + 5, insideY + 8);
      doc.font(fontBold).text(data.factureNum || '', startX + 110, insideY + 8);
      doc.moveTo(startX, insideY + 24).lineTo(startX + 280, insideY + 24).stroke();
      
      doc.font(fontNormal).text('MONTANT:', startX + 5, insideY + 32);
      doc.font(fontBold).text(data.amount ? `${data.amount} DA` : '', startX + 60, insideY + 32);

      doc.font(fontNormal).text('MODE DE PAIEMENT:', startX + 350, insideY + 4, { align: 'center', width: 200 });
      drawCheckbox('VIREMENT', payMeth.includes('vire'), startX + 340, insideY + 16);
      drawCheckbox('VERSEMENT', payMeth.includes('vers') || payMeth.includes('depo'), startX + 410, insideY + 16);
      drawCheckbox('CHEQUE', payMeth.includes('cheq'), startX + 340, insideY + 32);
      drawCheckbox('ESPECE', payMeth.includes('esp') || payMeth.includes('cash'), startX + 410, insideY + 32);

      doc.font(fontNormal).text('DATE:', startX + 555, insideY - 14 + 4);
      doc.font(fontBold).text(data.financeDate || dateStr, startX + 585, insideY - 14 + 4);
      doc.moveTo(startX + 550, insideY + 2).lineTo(startX + totalWidth, insideY + 2).stroke();
      
      doc.font(fontNormal).text('VISA ET CACHET:', startX + 555, insideY - 14 + 18);
      drawStamp(startX + 560, insideY - 14 + 26, 'COMPTABILITÉ', data.financeName, '#00a300');

      // -- SECTION 5: POSTE DE GARDE -------------------------------------------
      y += sectionHeight - 15 + gap;
      doc.rect(startX, y, totalWidth, sectionHeight - 15).strokeColor('#000').lineWidth(1.5).stroke();
      drawSectionHeader(y, 'POSTE DE GARDE');
      
      insideY = y + 14;
      doc.moveTo(startX + 280, insideY).lineTo(startX + 280, y + sectionHeight - 15).stroke();
      doc.moveTo(startX + 400, insideY).lineTo(startX + 400, y + sectionHeight - 15).stroke();
      doc.moveTo(startX + 550, insideY).lineTo(startX + 550, y + sectionHeight - 15).stroke();

      doc.font(fontNormal).text('N° BON DE LIVRAISON:', startX + 5, insideY + 8);
      doc.font(fontBold).text(data.blNum || '', startX + 110, insideY + 8);
      doc.moveTo(startX, insideY + 22).lineTo(startX + 280, insideY + 22).stroke();
      
      doc.font(fontNormal).text('QUANTITE:', startX + 5, insideY + 30);
      const totalQty = (data.articles || []).reduce((acc, cur) => acc + parseInt(cur.qty || 0), 0);
      doc.font(fontBold).text(`${totalQty}`, startX + 60, insideY + 30);
      doc.moveTo(startX, insideY + 44).lineTo(startX + 280, insideY + 44).stroke();

      doc.font(fontNormal).text('CHAUFFEUR:', startX + 5, insideY + 52);
      doc.font(fontBold).text(data.driverName || '', startX + 60, insideY + 52);
      doc.moveTo(startX, insideY + 66).lineTo(startX + 280, insideY + 66).stroke();

      doc.font(fontNormal).text('MATRICULE:', startX + 5, insideY + 72);
      doc.font(fontBold).text(data.vehiclePlate || '', startX + 60, insideY + 72);

      // Gate times
      doc.font(fontNormal).text("HEURE D'ENTREE:", startX + 285, insideY + 8);
      doc.font(fontBold).text(data.entryTime || '', startX + 360, insideY + 8);
      doc.moveTo(startX + 280, insideY + 22).lineTo(startX + 400, insideY + 22).stroke();

      doc.font(fontNormal).text("HEURE DE SORTIE:", startX + 285, insideY + 30);
      doc.font(fontBold).text(data.exitTime || '', startX + 365, insideY + 30);
      doc.moveTo(startX + 280, insideY + 44).lineTo(startX + 400, insideY + 44).stroke();

      doc.font(fontNormal).text("VISA", startX + 285, insideY + 52);
      doc.font(fontNormal).text("CHAUFFEUR:", startX + 285, insideY + 62);

      doc.font(fontNormal).text("DATE:", startX + 555, insideY + 4);
      doc.font(fontBold).text(data.guardDate || dateStr, startX + 585, insideY + 4);
      doc.moveTo(startX + 550, insideY + 16).lineTo(startX + totalWidth, insideY + 16).stroke();

      doc.font(fontNormal).text("VISA ET CACHET:", startX + 555, insideY + 20);
      drawStamp(startX + 560, insideY + 30, 'POSTE DE GARDE', data.guardName, '#2c3e50');

      doc.font(fontNormal).text("EQUIPE:", startX + 405, insideY + 72);
      doc.font(fontBold).text(data.guardShift || '', startX + 445, insideY + 72);
      doc.moveTo(startX + 400, insideY + 66).lineTo(startX + 550, insideY + 66).stroke();

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}
