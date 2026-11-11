import PDFDocument from "pdfkit";
import type { ContractDocument } from "@/lib/contracts/document";

const MARGIN = 64;
// Fixed dates keep the output byte-for-byte reproducible.
const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

/** Render a contract document to PDF bytes. Standard fonts only, no network. */
export function renderContractPdf(contract: ContractDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: contract.title,
        Author: "Vowlet demo contracts",
        CreationDate: FIXED_DATE,
        ModDate: FIXED_DATE,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - MARGIN * 2;

    contract.pages.forEach((blocks, index) => {
      if (index > 0) doc.addPage();
      for (const block of blocks) {
        switch (block.type) {
          case "title":
            doc.font("Helvetica-Bold").fontSize(20).text(block.text, { width }).moveDown(0.8);
            break;
          case "heading":
            doc.font("Helvetica-Bold").fontSize(12.5).text(block.text, { width }).moveDown(0.4);
            break;
          case "paragraph":
            doc.font("Helvetica").fontSize(10.5).text(block.text, { width, lineGap: 3 }).moveDown(0.9);
            break;
          case "fineprint":
            doc.font("Helvetica").fontSize(7).fillColor("#9a9a9a").text(block.text, { width, lineGap: 1 }).fillColor("black").moveDown(0.6);
            break;
          case "bullet":
            doc.font("Helvetica").fontSize(10.5).text(`- ${block.text}`, { width, lineGap: 3 }).moveDown(0.4);
            break;
          case "signature":
            doc.moveDown(2).font("Helvetica").fontSize(10.5);
            doc.text("Client: ______________________        Company: ______________________", { width });
            break;
        }
      }
    });

    // Page footers. Writing inside the bottom margin would add a page, so drop
    // the margin while drawing them.
    const pageCount = contract.pages.length;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font("Helvetica")
        .fontSize(9)
        .text(`Page ${i + 1} of ${pageCount}`, MARGIN, doc.page.height - 48, { width, align: "center", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }

    doc.end();
  });
}
