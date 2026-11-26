'use strict';

// The other way to reach the radio: let wfweb do the talking and pass the
// page's WebSocket straight through to it.
//
// Why a tunnel and not a direct connection from the page: wfweb serves HTTPS
// with a self-signed certificate, so a page from anywhere else would first
// have to get the browser to trust that certificate.

const tls = require('tls');

function tunnelToWfweb(req, clientSocket, head, { host, port }) {
  const upstream = tls.connect({
    host,
    port,
    // wfweb generates its own certificate; this hop never leaves the machine
    // unless the wfweb host is changed.
    rejectUnauthorized: false,
  });

  let reachedWfweb = false;
  const closeBoth = () => {
    clientSocket.destroy();
    upstream.destroy();
  };

  upstream.once('secureConnect', () => {
    reachedWfweb = true;
    // Host and Origin go through exactly as the browser sent them. wfweb
    // refuses a WebSocket whose Origin doesn't match its Host (so that some
    // other website open in the browser can't drive the radio), and that
    // check keeps working through this tunnel only if neither is rewritten.
    const lines = [`GET / HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      // Drop compression: frames pass through unparsed, so nothing here
      // could inflate them.
      if (name.toLowerCase() === 'sec-websocket-extensions') continue;
      lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  upstream.on('error', () => {
    // wfweb is not running: answer the handshake so the page can say so.
    if (!reachedWfweb && clientSocket.writable) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    }
    closeBoth();
  });
  clientSocket.on('error', closeBoth);
  upstream.on('close', closeBoth);
  clientSocket.on('close', closeBoth);
}

module.exports = { tunnelToWfweb };
