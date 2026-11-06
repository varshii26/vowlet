import { extractText, getDocumentProxy } from "unpdf";

/** The text of each page of a PDF; page n is element n - 1. */
export async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  // pdf.js rejects Node Buffers, so hand it a plain Uint8Array copy.
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}
