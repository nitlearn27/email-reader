import { getResolvedPDFJS } from "unpdf";

/**
 * Decrypt a password-protected PDF and return its text content.
 * Uses unpdf's serverless pdf.js build, which accepts a `password` option.
 */
export async function extractPdfText(bytes: Uint8Array, password?: string): Promise<string> {
  const { getDocument } = await getResolvedPDFJS();

  const doc = await getDocument({
    data: bytes,
    password: password ?? "",
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item: unknown) =>
        item && typeof item === "object" && "str" in item ? (item as { str: string }).str : "",
      )
      .join(" ");
    pages.push(line);
  }

  return pages.join("\n");
}
