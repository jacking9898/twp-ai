// Keep the native dynamic import outside the classic-script Babel pipeline.
globalThis.twpLoadPDF = () => import("./pdfjs/pdf.mjs");
