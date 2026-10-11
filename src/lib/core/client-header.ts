// Sent by the Tessera web app on every API call (ADR-011). A page on another site cannot send a header like
// this: the browser would first ask the server for permission (a CORS preflight), and Tessera never grants
// it. So the header says "this request comes from the Tessera page itself", even over plain HTTP, where
// browsers send neither Sec-Fetch-Site nor, for a same-origin GET, Origin.
export const CLIENT_HEADER = 'x-tessera-client';
export const CLIENT_HEADER_VALUE = 'web';
