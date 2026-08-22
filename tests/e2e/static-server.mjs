import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = resolve(
  fileURLToPath(new URL('../../', import.meta.url))
);
const host = '127.0.0.1';
const port = Number(process.env.E2E_PORT || 4173);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp']
]);

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${host}:${port}`);
    let pathname = decodeURIComponent(requestUrl.pathname);

    if (pathname.endsWith('/')) {
      pathname += 'index.html';
    }

    const filePath = resolve(repositoryRoot, `.${pathname}`);

    if (!filePath.startsWith(`${repositoryRoot}${sep}`)) {
      sendText(response, 403, 'Forbidden');
      return;
    }

    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type':
        contentTypes.get(extname(filePath)) || 'application/octet-stream'
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      sendText(response, 404, 'Not found');
      return;
    }

    console.error(error);
    sendText(response, 500, 'Internal server error');
  }
});

server.listen(port, host, () => {
  console.log(
    `NOVELIGHT browser test server listening on http://${host}:${port}`
  );
});

process.on('SIGTERM', () => {
  server.close();
});
