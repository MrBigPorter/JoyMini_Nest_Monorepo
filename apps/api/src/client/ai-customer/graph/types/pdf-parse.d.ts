declare module 'pdf-parse' {
  interface PdfMetadata {
    author?: string;
    creator?: string;
    producer?: string;
    title?: string;
    modDate?: string;
    [key: string]: any;
  }

  interface PdfData {
    numpages: number;
    numrender: number;
    info: PdfMetadata;
    metadata: PdfMetadata;
    text: string;
    version: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: any): Promise<PdfData>;
  export default pdfParse;
}
